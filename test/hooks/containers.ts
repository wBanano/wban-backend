import { execFileSync } from "child_process";
import { Client } from "pg";
import IORedis from "ioredis";

const startedContainers: string[] = [];

function docker(...args: string[]): string {
	return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function startContainer(image: string, port: number, env: string[]): number {
	const name = `wban-test-${image.replace(/[^a-z0-9]/gi, "-")}-${process.pid}`;
	docker(
		"run",
		"-d",
		"--rm",
		"--name",
		name,
		"-p",
		`127.0.0.1::${port}`,
		...env.flatMap((variable) => ["-e", variable]),
		image
	);
	startedContainers.push(name);
	const mapping = docker("port", name, `${port}/tcp`).split("\n")[0];
	return Number(mapping.split(":").pop());
}

async function eventually(probe: () => Promise<unknown>): Promise<void> {
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			// eslint-disable-next-line no-await-in-loop
			await probe();
			return;
		} catch (err) {
			if (Date.now() > deadline) {
				throw err;
			}
			// eslint-disable-next-line no-await-in-loop
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
	}
}

async function postgresAnswers(url: string): Promise<void> {
	const client = new Client({ connectionString: url });
	await client.connect();
	try {
		await client.query("select 1");
	} finally {
		await client.end();
	}
}

async function redisAnswers(url: string): Promise<void> {
	const redis = new IORedis(url, {
		lazyConnect: true,
		maxRetriesPerRequest: 0,
	});
	try {
		await redis.connect();
		await redis.ping();
	} finally {
		redis.disconnect();
	}
}

export const mochaHooks = {
	async beforeAll(this: Mocha.Context): Promise<void> {
		this.timeout(180_000);
		if (!process.env.TEST_DATABASE_URL) {
			const port = startContainer("postgres:18", 5432, [
				"POSTGRES_PASSWORD=test",
				"POSTGRES_DB=wban",
			]);
			process.env.TEST_DATABASE_URL = `postgres://postgres:test@127.0.0.1:${port}/wban`;
		}
		if (!process.env.TEST_REDIS_URL) {
			const port = startContainer("redis:8-alpine", 6379, []);
			process.env.TEST_REDIS_URL = `redis://127.0.0.1:${port}`;
		}
		await eventually(() => postgresAnswers(process.env.TEST_DATABASE_URL ?? ""));
		await eventually(() => redisAnswers(process.env.TEST_REDIS_URL ?? ""));
	},

	afterAll(): void {
		startedContainers.forEach((name) => docker("rm", "-f", name));
	},
};

import { Pool, PoolClient } from "pg";
import IORedis, { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { UsersDepositsStorage } from "../../src/storage/UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "../../src/storage/RedisUsersDepositsStorage";
import { PostgresUsersDepositsStorage } from "../../src/storage/PostgresUsersDepositsStorage";
import { LedgerMarker } from "../../src/storage/LedgerMarker";
import {
	createDatabase,
	Database,
	MIGRATIONS_FOLDER,
} from "../../src/storage/postgres/database";

export type HeldWrite = { reached: Promise<void>; release: () => void };

export type LedgerHarness = {
	storage: UsersDepositsStorage;
	redis: Redis;
	expirePendingClaims(): Promise<void>;
	holdNextBalanceWrite(): HeldWrite;
	close(): Promise<void>;
};

export type PostgresHarness = LedgerHarness & {
	storage: PostgresUsersDepositsStorage;
	db: Database;
	pool: Pool;
};

function heldWrite(): HeldWrite & {
	arrive: () => void;
	released: Promise<void>;
} {
	let arrive = () => {};
	let release = () => {};
	const reached = new Promise<void>((resolve) => {
		arrive = resolve;
	});
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { reached, release, arrive, released };
}

async function freshRedis(): Promise<Redis> {
	const redis = new IORedis(process.env.TEST_REDIS_URL ?? "");
	await redis.flushdb();
	return redis;
}

export async function redisLedger(): Promise<LedgerHarness> {
	const redis = await freshRedis();
	let hold: ReturnType<typeof heldWrite> | undefined;
	const multi = redis.multi.bind(redis);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(redis as any).multi = (...args: any[]) => {
		const pipeline = multi(...args);
		const current = hold;
		if (!current) {
			return pipeline;
		}
		hold = undefined;
		const exec = pipeline.exec.bind(pipeline);
		pipeline.exec = async () => {
			current.arrive();
			await current.released;
			return exec();
		};
		return pipeline;
	};
	return {
		storage: new RedisUsersDepositsStorage(redis),
		redis,
		async expirePendingClaims() {
			const keys = await redis.keys("claims:pending:*");
			await Promise.all(keys.map((key) => redis.pexpire(key, 1)));
			await new Promise((resolve) => setTimeout(resolve, 20));
		},
		holdNextBalanceWrite() {
			hold = heldWrite();
			return hold;
		},
		async close() {
			redis.disconnect();
		},
	};
}

let migrated: Promise<void> | undefined;

async function migrateOnce(db: Database): Promise<void> {
	migrated = migrated ?? migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return migrated;
}

export async function truncateLedger(db: Database): Promise<void> {
	await db.execute(
		sql`truncate chain_meta, accounts, ledger_entries, claims, gasless_swaps, scan_state, migration_discrepancies restart identity cascade`
	);
}

function holdingPool(
	pool: Pool,
	nextHold: () => ReturnType<typeof heldWrite> | undefined,
	clearHold: () => void
): Pool {
	pool.on("error", () => undefined);
	pool.on("connect", (client: PoolClient) => {
		const query = client.query.bind(client);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(client as any).query = (config: any, ...rest: any[]) => {
			const text = typeof config === "string" ? config : config?.text;
			const current = nextHold();
			if (!current || !String(text).startsWith('update "accounts"')) {
				return query(config, ...rest);
			}
			clearHold();
			current.arrive();
			return current.released.then(() => query(config, ...rest));
		};
	});
	return pool;
}

export async function postgresLedger(): Promise<PostgresHarness> {
	let hold: ReturnType<typeof heldWrite> | undefined;
	const pool = holdingPool(
		new Pool({ connectionString: process.env.TEST_DATABASE_URL }),
		() => hold,
		() => {
			hold = undefined;
		}
	);
	const db = createDatabase(pool);
	await migrateOnce(db);
	await truncateLedger(db);
	const redis = await freshRedis();
	return {
		storage: new PostgresUsersDepositsStorage(db, new LedgerMarker(redis)),
		db,
		pool,
		redis,
		async expirePendingClaims() {
			await db.execute(
				sql`update claims set expires_at = now() - interval '1 second' where status = 'pending'`
			);
		},
		holdNextBalanceWrite() {
			hold = heldWrite();
			return hold;
		},
		async close() {
			redis.disconnect();
			await pool.end();
		},
	};
}

export const ledgers: { name: string; open: () => Promise<LedgerHarness> }[] = [
	{ name: "redis", open: redisLedger },
	{ name: "postgres", open: postgresLedger },
];

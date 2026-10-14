import IORedis, { Redis } from "ioredis";
import { Pool } from "pg";
import { ethers } from "ethers";
import config from "../ledgerConfig";
import {
	Database,
	assertChainMatches,
	assertSchemaIsCurrent,
	chainIdentityFromConfig,
	createDatabase,
	poolConfigFromEnv,
} from "../storage/postgres/database";
import { readSnapshot, LedgerSnapshot } from "./migration/snapshot";
import { planMigration, MigrationPlan } from "./migration/plan";
import { formatReport, TargetState } from "./migration/report";
import { countTargetRows, writePlan } from "./migration/write";
import { verifyMigration } from "./migration/verify";
import {
	recoverBanAddresses,
	unwrapsWithoutBanAddress,
} from "./migration/recoverBanAddresses";
import safeErrorMessage from "./migration/safeErrorMessage";

const USAGE = `usage: yarn ledger:migrate-redis [--dry-run | --write | --verify] [options]
  --dry-run            read Redis and print the report, write nothing (default)
  --write              migrate into the empty Postgres ledger, then verify
  --verify             compare the Redis and Postgres ledgers, write nothing
  --sample=N           compare the routes of N random accounts instead of all
  --skip-unknown-keys  record unknown Redis keys as discrepancies instead of refusing
  --no-chain           don't look up missing unwrap BAN addresses on the chain
  --list=N             list at most N items per report section (default 50)`;

type Mode = "dry-run" | "write" | "verify";

type Options = {
	mode: Mode;
	sample: number | undefined;
	skipUnknownKeys: boolean;
	chain: boolean;
	listLimit: number;
};

function numberFlag(args: string[], name: string): number | undefined {
	const flag = args.find((arg) => arg.startsWith(`--${name}=`));
	return flag ? Number(flag.split("=")[1]) : undefined;
}

function parseOptions(args: string[]): Options | undefined {
	const known = [
		"--dry-run",
		"--write",
		"--verify",
		"--skip-unknown-keys",
		"--no-chain",
	];
	const unknown = args.filter(
		(arg) => !known.includes(arg) && !/^--(sample|list)=\d+$/.test(arg)
	);
	const modes = (["write", "verify", "dry-run"] as Mode[]).filter((mode) =>
		args.includes(`--${mode}`)
	);
	if (unknown.length > 0 || modes.length > 1) {
		return undefined;
	}
	return {
		mode: modes[0] ?? "dry-run",
		sample: numberFlag(args, "sample"),
		skipUnknownKeys: args.includes("--skip-unknown-keys"),
		chain: !args.includes("--no-chain"),
		listLimit: numberFlag(args, "list") ?? 50,
	};
}

async function recoveredBanAddresses(
	snapshot: LedgerSnapshot,
	options: Options
): Promise<Map<string, string>> {
	const unwraps = unwrapsWithoutBanAddress(snapshot);
	if (unwraps.length === 0 || !options.chain || !config.BlockchainJsonRpc) {
		return new Map();
	}
	console.log(
		`Looking up the BAN address of ${unwraps.length} unwraps on the chain...`
	);
	const provider = new ethers.providers.JsonRpcProvider(
		config.BlockchainJsonRpc,
		{
			name: config.BlockchainNetworkName,
			chainId: config.BlockchainNetworkChainId,
		}
	);
	return recoverBanAddresses(provider, config.WBANContractAddress, unwraps);
}

async function describeTarget(db: Database): Promise<TargetState> {
	const schema = await assertSchemaIsCurrent(db).then(
		() => "ok",
		(err) => safeErrorMessage(err)
	);
	if (schema !== "ok") {
		return { schema, chain: "not checked", rows: {} };
	}
	return {
		schema,
		chain: await assertChainMatches(db, chainIdentityFromConfig()).then(
			() => "ok",
			(err) => safeErrorMessage(err)
		),
		rows: await countTargetRows(db),
	};
}

async function verify(
	redis: Redis,
	db: Database,
	plan: MigrationPlan,
	sample: number | undefined
): Promise<boolean> {
	console.log(
		`\nVerifying ${
			sample ? `${sample} sampled` : "all"
		} accounts against Redis...`
	);
	const differences = await verifyMigration(redis, db, plan, sample);
	if (differences.length === 0) {
		console.log("Verification passed: Redis and Postgres agree");
		return true;
	}
	console.log(`Verification failed with ${differences.length} differences:`);
	differences
		.slice(0, 50)
		.forEach((difference) =>
			console.log(
				`  ${difference.check} ${
					difference.subject
				}\n    redis:    ${JSON.stringify(
					difference.redis
				)}\n    postgres: ${JSON.stringify(difference.postgres)}`
			)
		);
	return false;
}

async function run(options: Options): Promise<boolean> {
	const redis = new IORedis({
		host: config.RedisHost,
		password: config.RedisPassword,
		maxRetriesPerRequest: 1,
		retryStrategy: (attempt) => (attempt > 3 ? null : 500),
	});
	redis.on("error", (err) => console.error(`Redis: ${safeErrorMessage(err)}`));
	const pool = config.DatabaseHost ? new Pool(poolConfigFromEnv()) : undefined;
	const db = pool && createDatabase(pool);
	try {
		const snapshot = await readSnapshot(redis);
		const plan = planMigration(snapshot, {
			recoveredBanAddresses: await recoveredBanAddresses(snapshot, options),
			skipUnknownKeys: options.skipUnknownKeys,
		});
		console.log(
			formatReport(
				snapshot,
				plan,
				db && (await describeTarget(db)),
				options.listLimit
			)
		);
		if (options.mode === "dry-run") {
			return true;
		}
		if (!db) {
			throw new Error(
				`--${options.mode} needs DATABASE_HOST and the other database settings`
			);
		}
		await assertSchemaIsCurrent(db);
		await assertChainMatches(db, chainIdentityFromConfig());
		if (options.mode === "write") {
			await writePlan(db, plan);
			console.log("\nWrote the plan in one transaction");
		}
		return await verify(redis, db, plan, options.sample);
	} finally {
		redis.disconnect();
		await pool?.end();
	}
}

const options = parseOptions(process.argv.slice(2));
if (!options) {
	console.log(USAGE);
	process.exit(2);
}
run(options)
	.then((ok) => process.exit(ok ? 0 : 1))
	.catch((err) => {
		console.error(safeErrorMessage(err));
		process.exit(1);
	});

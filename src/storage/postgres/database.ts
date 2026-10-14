import path from "path";
import { Pool, PoolConfig } from "pg";
import { sql } from "drizzle-orm";
import { drizzle, NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema";
import config from "../../config";

export type Database = NodePgDatabase<typeof schema>;

export const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../../drizzle");

export type ChainIdentity = { networkName: string; chainId: number };

export function poolConfigFromEnv(): PoolConfig {
	return {
		host: config.DatabaseHost,
		port: config.DatabasePort,
		database: config.DatabaseName,
		user: config.DatabaseUser,
		password: config.DatabasePassword,
	};
}

export function createDatabase(
	pool: Pool = new Pool(poolConfigFromEnv())
): Database {
	return drizzle(pool, { schema });
}

export function chainIdentityFromConfig(): ChainIdentity {
	return {
		networkName: config.BlockchainNetworkName,
		chainId: config.BlockchainNetworkChainId,
	};
}

function describeChain({ networkName, chainId }: ChainIdentity): string {
	return `${networkName} (chain id ${chainId})`;
}

async function latestAppliedMigration(db: Database) {
	const { rows: tables } = await db.execute<{ name: string | null }>(
		sql`select to_regclass('drizzle.__drizzle_migrations')::text as name`
	);
	if (!tables[0]?.name) {
		return undefined;
	}
	const { rows } = await db.execute<{ hash: string; appliedAt: string }>(
		sql`select hash, created_at as "appliedAt" from drizzle.__drizzle_migrations order by created_at desc limit 1`
	);
	return rows[0];
}

export async function assertSchemaIsCurrent(db: Database): Promise<void> {
	const migrations = readMigrationFiles({
		migrationsFolder: MIGRATIONS_FOLDER,
	});
	const expected = migrations[migrations.length - 1];
	if (!expected) {
		throw new Error(`No migrations found in ${MIGRATIONS_FOLDER}`);
	}
	const latest = await latestAppliedMigration(db);
	if (!latest) {
		throw new Error("Database schema is not migrated, run yarn db:migrate");
	}
	if (
		latest.hash !== expected.hash ||
		Number(latest.appliedAt) !== expected.folderMillis
	) {
		throw new Error(
			`Database schema ${latest.appliedAt} does not match this build's ${expected.folderMillis}`
		);
	}
}

export async function assertChainMatches(
	db: Database,
	expected: ChainIdentity
): Promise<void> {
	const [stored] = await db.select().from(schema.chainMeta);
	if (!stored) {
		throw new Error("chain_meta is empty, run yarn db:migrate");
	}
	if (
		stored.networkName !== expected.networkName ||
		stored.chainId !== expected.chainId
	) {
		throw new Error(
			`This database holds the ledger of ${describeChain(
				stored
			)}, not ${describeChain(expected)}`
		);
	}
}

export async function migrateDatabase(
	db: Database,
	chain: ChainIdentity
): Promise<void> {
	if (!chain.networkName || !chain.chainId) {
		throw new Error(
			"BC_NETWORK_NAME and BC_NETWORK_CHAIN_ID must be set to migrate"
		);
	}
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	await db
		.insert(schema.chainMeta)
		.values({ networkName: chain.networkName, chainId: chain.chainId })
		.onConflictDoNothing();
	await assertChainMatches(db, chain);
}

import IORedis from "ioredis";
import config, { LedgerBackend } from "../config";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./RedisUsersDepositsStorage";
import { PostgresUsersDepositsStorage } from "./PostgresUsersDepositsStorage";
import { LedgerMarker } from "./LedgerMarker";
import { LedgerHealth } from "./postgres/LedgerHealth";
import { createDatabase } from "./postgres/database";

export type Ledger = {
	storage: UsersDepositsStorage;
	health?: LedgerHealth;
};

function createPostgresLedger(): Ledger {
	const db = createDatabase();
	const marker = new LedgerMarker(
		new IORedis({ host: config.RedisHost, password: config.RedisPassword })
	);
	return {
		storage: new PostgresUsersDepositsStorage(db, marker),
		health: new LedgerHealth(db),
	};
}

export default function createLedger(
	backend: LedgerBackend = config.StorageBackend
): Ledger {
	switch (backend) {
		case "postgres":
			return createPostgresLedger();
		case "redis":
		default:
			return { storage: new RedisUsersDepositsStorage() };
	}
}

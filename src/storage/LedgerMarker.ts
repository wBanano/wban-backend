import { Redis } from "ioredis";
import LedgerMovedToPostgresError from "../errors/LedgerMovedToPostgresError";

const LEDGER_BACKEND_KEY = "ledger:backend";
const POSTGRES = "postgres";

export class LedgerMarker {
	private redis: Redis;

	constructor(redis: Redis) {
		this.redis = redis;
	}

	async isOnPostgres(): Promise<boolean> {
		return (await this.redis.get(LEDGER_BACKEND_KEY)) === POSTGRES;
	}

	async assertOnRedis(): Promise<void> {
		if (await this.isOnPostgres()) {
			throw new LedgerMovedToPostgresError(LEDGER_BACKEND_KEY);
		}
	}

	async markOnPostgres(): Promise<void> {
		await this.redis.set(LEDGER_BACKEND_KEY, POSTGRES);
	}
}

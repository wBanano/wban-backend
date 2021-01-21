import { Logger } from "tslog";
import { createNodeRedisClient } from "handy-redis";
import BigNumber from "@bananocoin/bananojs";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import config from "./config";

class RedisUsersDepositsStorage implements UsersDepositsStorage {
	private redis: any;

	private log: Logger = new Logger();

	constructor() {
		this.redis = createNodeRedisClient({ host: config.RedisHost });
	}

	async getUserAvailableBalance(from: string): Promise<number> {
		return this.redis.get(from);
	}

	async storeUserDeposit(
		from: string,
		amount: number,
		hash: string
	): Promise<void> {
		this.log.info(
			`Storing user deposit from: ${from}, amount: ${amount} BAN, hash: ${hash}`
		);
		await this.redis
			.multi()
			.incrbyfloat(from, amount)
			.sadd(`txn-${from}`, hash)
			.exec();
	}

	async storeUserSwap(from: string, amount: BigNumber): Promise<void> {
		this.log.info(`Storing swap of ${amount} BAN for user ${from}`);
		await this.redis
			.multi()
			.incrbyfloat(from, -1 * amount)
			.lpush(`swaps-${from}`, amount)
			.exec();
	}

	async containsTransaction(from: string, hash: string): Promise<boolean> {
		this.log.info(
			`Checking if transaction from ${from} with hash ${hash} was already processed...`
		);
		const isAlreadyStored = await this.redis.sismember(`txn-${from}`, hash);
		return isAlreadyStored === 1;
	}
}

export { RedisUsersDepositsStorage };

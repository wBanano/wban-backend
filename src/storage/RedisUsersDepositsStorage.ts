import { Logger } from "tslog";
import Redis from "ioredis";
import Redlock from "redlock";
import { BigNumber } from "ethers";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import config from "../config";

class RedisUsersDepositsStorage implements UsersDepositsStorage {
	private redis: Redis;

	private redlock: Redlock;

	private log: Logger = config.Logger.getChildLogger();

	constructor() {
		this.redis = new Redis({ host: config.RedisHost });
		this.redlock = new Redlock([this.redis], {
			// the expected clock drift; for more details
			// see http://redis.io/topics/distlock
			driftFactor: 0.01, // multiplied by lock ttl to determine drift time
			// the max number of times Redlock will attempt
			// to lock a resource before erroring
			retryCount: 10,
			// the time in ms between attempts
			retryDelay: 200, // time in ms
			// the max time in ms randomly added to retries
			// to improve performance under high contention
			// see https://www.awsarchitectureblog.com/2015/03/backoff.html
			retryJitter: 200, // time in ms
		});
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		const rawAmount: string = await this.redis.get(`deposits:${from}`);
		return BigNumber.from(rawAmount);
	}

	async hasPendingClaim(banAddress: string): Promise<boolean> {
		this.log.info(
			`Checking if there is already a pending claim for ${banAddress}...`
		);
		const pendingClaims = await this.redis.keys(
			`claims:pending:${banAddress}:*`
		);
		const exists = pendingClaims.length > 0;
		this.log.debug(exists);
		return exists;
	}

	async storePendingClaim(
		banAddress: string,
		bscAddress: string
	): Promise<boolean> {
		try {
			const key = `claims:pending:${banAddress}:${bscAddress}`;
			this.log.debug(`Key is ${key}`);
			await this.redis
				.multi()
				.set(key, "1")
				.expire(key, 5 * 60) // 5 minutes
				.exec();
			this.log.info(`Stored pending claim for ${banAddress} and ${bscAddress}`);
			return true;
		} catch (err) {
			this.log.error(err);
			return false;
		}
	}

	async hasClaim(banAddress: string): Promise<boolean> {
		this.log.info(`Checking if there is a claim for ${banAddress}...`);
		const pendingClaims = await this.redis.keys(`claims:${banAddress}:*`);
		const exists = pendingClaims.length > 0;
		this.log.debug(exists);
		return exists;
	}

	async storeClaim(banAddress: string): Promise<boolean> {
		const pendingClaims = await this.redis.keys(
			`claims:pending:${banAddress}:*`
		);
		const key = pendingClaims[0].replace(":pending", "");
		// claims:pending:ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o:0xec410e9f2756c30be4682a7e29918082adc12b55
		await this.redis.set(key, 1);
		this.log.info(`Stored claim for ${banAddress} and ${key}`);
		return true;
	}

	async storeUserDeposit(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		this.log.info(
			`Storing user deposit from: ${from}, amount: ${amount} BAN, hash: ${hash}`
		);
		this.redlock.lock(`locks:deposits:${from}`, 1_000).then(async (lock) => {
			let rawBalance: string | null;
			try {
				rawBalance = await this.redis.get(`deposits:${from}`);
				let balance: BigNumber;
				if (rawBalance) {
					balance = BigNumber.from(rawBalance);
				} else {
					balance = BigNumber.from(0);
				}
				balance = balance.add(amount);

				await this.redis
					.multi()
					.set(`deposits:${from}`, balance.toString())
					.sadd(`txn:${from}`, hash)
					.exec();
				this.log.info(
					`Stored user deposit from: ${from}, amount: ${amount} BAN, hash: ${hash}`
				);
			} catch (err) {
				this.log.error(err);
			}

			// unlock resource when done
			return lock.unlock().catch((err) => this.log.error(err));
		});
	}

	async storeUserSwap(from: string, amount: BigNumber): Promise<void> {
		this.log.info(`TODO: Storing swap of ${amount} BAN for user ${from}`);
		/*
		await this.redis
			.multi()
			.incrbyfloat(from, -1 * amount)
			.lpush(`swaps:${from}`, amount)
			.exec();
			*/
	}

	async containsTransaction(from: string, hash: string): Promise<boolean> {
		this.log.info(
			`Checking if transaction from ${from} with hash ${hash} was already processed...`
		);
		const isAlreadyStored = await this.redis.sismember(`txn:${from}`, hash);
		return isAlreadyStored === 1;
	}
}

export { RedisUsersDepositsStorage };

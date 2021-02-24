import { Logger } from "tslog";
import Redis from "ioredis";
import Redlock from "redlock";
import { ethers, BigNumber } from "ethers";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import SwapToBanEvent from "../models/events/SwapToBanEvent";
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
		if (rawAmount === null) {
			return BigNumber.from(0);
		}
		return BigNumber.from(rawAmount);
	}

	async lockBalance(from: string): Promise<void> {
		return this.redis.set(`locks:balance:${from}`, "1");
	}

	async unlockBalance(from: string): Promise<void> {
		return this.redis.del(`locks:balance:${from}`);
	}

	async isBalanceLocked(from: string): Promise<boolean> {
		return (await this.redis.exists(`locks:balance:${from}`)) === "1";
	}

	async hasPendingClaim(banAddress: string): Promise<boolean> {
		const pendingClaims = await this.redis.keys(
			`claims:pending:${banAddress}:*`
		);
		const exists = pendingClaims.length > 0;
		this.log.debug(
			`Checked if there is already a pending claim for ${banAddress}: ${exists}`
		);
		return exists;
	}

	async storePendingClaim(
		banAddress: string,
		bscAddress: string
	): Promise<boolean> {
		try {
			const key = `claims:pending:${banAddress}:${bscAddress}`;
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
		const pendingClaims = await this.redis.keys(`claims:${banAddress}:*`);
		const exists = pendingClaims.length > 0;
		this.log.debug(`Checked if there is a claim for ${banAddress}: ${exists}`);
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

	async storeUserWithdrawal(
		from: string,
		amount: BigNumber,
		sig: string
	): Promise<void> {
		this.log.info(`Storing user withdrawal to: ${from}, amount: ${amount} BAN`);
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
				balance = balance.sub(amount);

				await this.redis
					.multi()
					.set(`deposits:${from}`, balance.toString())
					.sadd(`txn:${from}`, sig)
					.exec();
				this.log.info(
					`Stored user withdrawal from: ${from}, amount: ${amount} BAN, sig: ${sig}`
				);
			} catch (err) {
				this.log.error(err);
			}

			// unlock resource when done
			return lock.unlock().catch((err) => this.log.error(err));
		});
	}

	async storeUserSwap(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		this.log.info(`Storing swap of ${amount} BAN for user ${from}`);
		this.redlock
			.lock(`locks:swaps:ban-to-wban:${from}`, 1_000)
			.then(async (lock) => {
				let rawBalance: string | null;
				try {
					rawBalance = await this.redis.get(`deposits:${from}`);
					let balance: BigNumber;
					if (rawBalance) {
						balance = BigNumber.from(rawBalance);
					} else {
						balance = BigNumber.from(0);
					}
					balance = balance.sub(amount);

					await this.redis
						.multi()
						.set(`deposits:${from}`, balance.toString())
						.sadd(`swaps:ban-to-wban:${from}`, hash)
						.exec();
					this.log.info(
						`Stored user swap from: ${from}, amount: ${amount} BAN, hash: ${hash}`
					);
				} catch (err) {
					this.log.error(err);
				}

				// unlock resource when done
				return lock.unlock().catch((err) => this.log.error(err));
			});
	}

	async containsTransaction(from: string, hash: string): Promise<boolean> {
		this.log.info(
			`Checking if transaction from ${from} with hash ${hash} was already processed...`
		);
		const isAlreadyStored = await this.redis.sismember(`txn:${from}`, hash);
		return isAlreadyStored === 1;
	}

	async getLastBSCBlockProcessed(): Promise<number> {
		const rawBlockValue = await this.redis.get("bsc:blocks:latest");
		if (rawBlockValue === null) {
			return config.BinanceSmartChainWalletPendingTransactionsStartFromBlock;
		}
		return Number.parseInt(rawBlockValue, 10);
	}

	async setLastBSCBlockProcessed(block: number): Promise<void> {
		return this.redis.set("bsc:blocks:latest", block.toString());
	}

	async storeUserSwapToBan(event: SwapToBanEvent): Promise<void> {
		await this.redis.sadd(`swaps:wban-to-ban:${event.from}`, event.hash);
		this.log.info(
			`Stored user swap for ${event.from} from ${ethers.utils.formatEther(
				event.amount
			)} wBAN to BAN`
		);
	}

	async swapToBanWasAlreadyDone(event: SwapToBanEvent): Promise<boolean> {
		this.log.info(
			`Checking if swap from ${event.from} with hash ${event.hash} was already processed...`
		);
		const isAlreadyProcessed = await this.redis.sismember(
			`swaps:wban-to-ban:${event.from}`,
			event.hash
		);
		return isAlreadyProcessed === 1;
	}
}

export { RedisUsersDepositsStorage };

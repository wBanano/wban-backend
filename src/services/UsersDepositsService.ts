import { Logger } from "tslog";
import { ethers, BigNumber } from "ethers";
import config from "../config";
import { UsersDepositsStorage } from "../storage/UsersDepositsStorage";
import SwapToBanEvent from "../models/events/SwapToBanEvent";
import BalanceLockedError from "../errors/BalanceLockedError";

class UsersDepositsService {
	private usersDepositsStorage: UsersDepositsStorage;

	private log: Logger = config.Logger.getChildLogger();

	constructor(usersDepositsStorage: UsersDepositsStorage) {
		this.usersDepositsStorage = usersDepositsStorage;
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		const balance = await this.usersDepositsStorage.getUserAvailableBalance(
			from
		);
		return balance;
	}

	async lockBalance(from: string): Promise<void> {
		if (await this.usersDepositsStorage.isBalanceLocked(from)) {
			throw new BalanceLockedError();
		}
		return this.usersDepositsStorage.lockBalance(from);
	}

	async unlockBalance(from: string): Promise<void> {
		return this.usersDepositsStorage.unlockBalance(from);
	}

	async hasPendingClaim(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.hasPendingClaim(banAddress);
	}

	async storePendingClaim(
		banAddress: string,
		bscAddress: string
	): Promise<boolean> {
		if (await this.usersDepositsStorage.hasPendingClaim(banAddress)) {
			return false;
		}
		return this.usersDepositsStorage.storePendingClaim(banAddress, bscAddress);
	}

	async hasClaim(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.hasClaim(banAddress);
	}

	async confirmClaim(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.storeClaim(banAddress);
	}

	async storeUserDeposit(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		// check if the transaction wasn't already ingested!
		if (await this.usersDepositsStorage.containsTransaction(from, hash)) {
			this.log.warn(
				`Transaction ${hash} from ${from} was already processed. Skipping it...`
			);
			return;
		}
		// store the user deposit
		this.usersDepositsStorage.storeUserDeposit(from, amount, hash);
	}

	async storeUserWithdrawal(
		from: string,
		amount: BigNumber,
		sig: string
	): Promise<void> {
		// store the user withdrawal
		this.usersDepositsStorage.storeUserWithdrawal(from, amount, sig);
	}

	async storeUserSwap(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		return this.usersDepositsStorage.storeUserSwap(from, amount, hash);
	}

	async getLastBSCBlockProcessed(): Promise<number> {
		return this.usersDepositsStorage.getLastBSCBlockProcessed();
	}

	async setLastBSCBlockProcessed(block: number): Promise<void> {
		return this.usersDepositsStorage.setLastBSCBlockProcessed(block);
	}

	async swapToBan(event: SwapToBanEvent): Promise<void> {
		return this.usersDepositsStorage.storeUserSwapToBan(event);
	}

	async swapToBanWasAlreadyDone(event: SwapToBanEvent): Promise<boolean> {
		return this.usersDepositsStorage.swapToBanWasAlreadyDone(event);
	}
}

export { UsersDepositsService };

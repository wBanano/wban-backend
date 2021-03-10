import { Logger } from "tslog";
import { BigNumber } from "ethers";
import config from "../config";
import { UsersDepositsStorage } from "../storage/UsersDepositsStorage";
import Withdrawal from "../models/operations/Withdrawal";
import SwapWBANToBan from "../models/operations/SwapWBANToBan";

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

	async isClaimed(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.isClaimed(banAddress);
	}

	async hasClaim(banAddress: string, bscAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.hasClaim(banAddress, bscAddress);
	}

	async confirmClaim(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.confirmClaim(banAddress);
	}

	async storeUserDeposit(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		// check if the transaction wasn't already ingested!
		if (
			await this.usersDepositsStorage.containsUserDepositTransaction(from, hash)
		) {
			this.log.warn(
				`User deposit transaction ${hash} from ${from} was already processed. Skipping it...`
			);
			return;
		}
		// store the user deposit
		this.usersDepositsStorage.storeUserDeposit(from, amount, hash);
	}

	async containsUserWithdrawalRequest(
		withdrawal: Withdrawal
	): Promise<boolean> {
		return this.usersDepositsStorage.containsUserWithdrawalRequest(
			withdrawal.bscWallet,
			withdrawal.date
		);
	}

	async storeUserWithdrawal(
		from: string,
		amount: BigNumber,
		date: string
	): Promise<void> {
		// check if the transaction wasn't already ingested!
		if (
			await this.usersDepositsStorage.containsUserWithdrawalRequest(from, date)
		) {
			this.log.warn(
				`User withdrawal request from ${from} with date ${date} was already processed. Skipping it...`
			);
			return;
		}
		// store the user withdrawal
		this.usersDepositsStorage.storeUserWithdrawal(from, amount, date);
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

	async swapToBan(event: SwapWBANToBan): Promise<void> {
		return this.usersDepositsStorage.storeUserSwapToBan(event);
	}

	async swapToBanWasAlreadyDone(event: SwapWBANToBan): Promise<boolean> {
		return this.usersDepositsStorage.swapToBanWasAlreadyDone(event);
	}
}

export { UsersDepositsService };

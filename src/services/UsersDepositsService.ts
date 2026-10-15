import { Logger } from "tslog";
import { BigNumber } from "ethers";
import config from "../config";
import {
	MintReceipt,
	UsersDepositsStorage,
} from "../storage/UsersDepositsStorage";
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
		blockchainAddress: string
	): Promise<boolean> {
		if (await this.usersDepositsStorage.hasPendingClaim(banAddress)) {
			return false;
		}
		return this.usersDepositsStorage.storePendingClaim(
			banAddress,
			blockchainAddress
		);
	}

	async isClaimed(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.isClaimed(banAddress);
	}

	async isClaimedFromETH(blockchainAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.isClaimedFromETH(blockchainAddress);
	}

	async hasClaim(
		banAddress: string,
		blockchainAddress: string
	): Promise<boolean> {
		return this.usersDepositsStorage.hasClaim(banAddress, blockchainAddress);
	}

	async confirmClaim(banAddress: string): Promise<boolean> {
		return this.usersDepositsStorage.confirmClaim(banAddress);
	}

	async getBanAddressesForBlockchainAddress(
		blockchainAddress: string
	): Promise<Array<string>> {
		return this.usersDepositsStorage.getBanAddressesForBlockchainAddress(
			blockchainAddress
		);
	}

	async storeUserDeposit(
		banAddress: string,
		amount: BigNumber,
		timestamp: number,
		hash: string
	): Promise<void> {
		// check if the transaction wasn't already ingested!
		if (
			await this.usersDepositsStorage.containsUserDepositTransaction(
				banAddress,
				hash
			)
		) {
			this.log.warn(
				`User deposit transaction ${hash} from ${banAddress} was already processed. Skipping it...`
			);
			return;
		}
		// store the user deposit
		await this.usersDepositsStorage.storeUserDeposit(
			banAddress,
			amount,
			timestamp,
			hash
		);
	}

	async containsUserWithdrawalRequest(
		withdrawal: Withdrawal
	): Promise<boolean> {
		return this.usersDepositsStorage.containsUserWithdrawalRequest(
			withdrawal.banWallet,
			withdrawal.timestamp
		);
	}

	async reserveRefund(
		depositHash: string,
		banAddress: string,
		amount: BigNumber
	): Promise<boolean> {
		return this.usersDepositsStorage.reserveRefund(
			depositHash,
			banAddress,
			amount
		);
	}

	async storeRefund(depositHash: string, sendHash: string): Promise<void> {
		return this.usersDepositsStorage.storeRefund(depositHash, sendHash);
	}

	async hasRefund(depositHash: string): Promise<boolean> {
		return this.usersDepositsStorage.hasRefund(depositHash);
	}

	async reserveUserWithdrawal(
		banAddress: string,
		amount: BigNumber,
		timestamp: number
	): Promise<void> {
		return this.usersDepositsStorage.reserveUserWithdrawal(
			banAddress,
			amount,
			timestamp
		);
	}

	async storeUserWithdrawal(
		banAddress: string,
		amount: BigNumber,
		timestamp: number,
		hash: string
	): Promise<void> {
		return this.usersDepositsStorage.storeUserWithdrawal(
			banAddress,
			amount,
			timestamp,
			hash
		);
	}

	async storeUserSwapToWBan(
		banWallet: string,
		blockchainWallet: string,
		amount: BigNumber,
		timestamp: number,
		receipt: string,
		uuid: string
	): Promise<void> {
		return this.usersDepositsStorage.storeUserSwapToWBan(
			banWallet,
			blockchainWallet,
			amount,
			timestamp,
			receipt,
			uuid
		);
	}

	async getSwapToWBan(
		banWallet: string,
		timestamp: number
	): Promise<MintReceipt | undefined> {
		return this.usersDepositsStorage.getSwapToWBan(banWallet, timestamp);
	}

	async getLastBlockchainBlockProcessed(): Promise<number> {
		return this.usersDepositsStorage.getLastBlockchainBlockProcessed();
	}

	async setLastBlockchainBlockProcessed(block: number): Promise<void> {
		return this.usersDepositsStorage.setLastBlockchainBlockProcessed(block);
	}

	async storeUserSwapToBan(event: SwapWBANToBan): Promise<void> {
		return this.usersDepositsStorage.storeUserSwapToBan(event);
	}

	async containsUserSwapToBan(event: SwapWBANToBan): Promise<boolean> {
		return this.usersDepositsStorage.swapToBanWasAlreadyDone(event);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async getDeposits(banWallet: string): Promise<Array<any>> {
		return this.usersDepositsStorage.getDeposits(banWallet);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getWithdrawals(banWallet: string): Promise<Array<any>> {
		return this.usersDepositsStorage.getWithdrawals(banWallet);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getSwaps(blockchainAddress: string, banWallet: string): Promise<Array<any>> {
		return this.usersDepositsStorage.getSwaps(blockchainAddress, banWallet);
	}

	async isFreeSwapAlreadyDone(from: string): Promise<boolean> {
		return this.usersDepositsStorage.isFreeSwapAlreadyDone(from);
	}

	async reserveFreeSwap(from: string): Promise<boolean> {
		return this.usersDepositsStorage.reserveFreeSwap(from);
	}

	async releaseFreeSwap(from: string): Promise<void> {
		return this.usersDepositsStorage.releaseFreeSwap(from);
	}

	async storeFreeSwap(from: string, txnId: string): Promise<void> {
		return this.usersDepositsStorage.storeFreeSwap(from, txnId);
	}
}

export { UsersDepositsService };

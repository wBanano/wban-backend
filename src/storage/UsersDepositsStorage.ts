import { BigNumber } from "ethers";
import SwapWBANToBan from "../models/operations/SwapWBANToBan";

interface UsersDepositsStorage {
	getUserAvailableBalance(from: string): Promise<BigNumber>;
	/*
	lockBalance(from: string): Promise<void>;
	unlockBalance(from: string): Promise<void>;
	isBalanceLocked(from: string): Promise<boolean>;
	*/

	hasPendingClaim(banAddress: string): Promise<boolean>;
	storePendingClaim(
		banAddress: string,
		blockchainAddress: string
	): Promise<boolean>;
	isClaimed(banAddress: string): Promise<boolean>;
	isClaimedFromETH(blockchainAddress: string): Promise<boolean>;
	hasClaim(banAddress: string, blockchainAddress: string): Promise<boolean>;
	confirmClaim(banAddress: string): Promise<boolean>;
	getBanAddressesForBlockchainAddress(
		blockchainAddress: string
	): Promise<Array<string>>;

	storeUserDeposit(
		banAddress: string,
		amount: BigNumber,
		timestamp: number,
		hash: string
	): Promise<void>;
	containsUserDepositTransaction(
		banAddress: string,
		hash: string
	): Promise<boolean>;
	storeUserWithdrawal(
		banAddress: string,
		amount: BigNumber,
		timestamp: number,
		hash: string
	): Promise<void>;
	containsUserWithdrawalRequest(
		banAddress: string,
		timestamp: number
	): Promise<boolean>;

	storeUserSwapToWBan(
		banAddress: string,
		blockchainAddress: string,
		amount: BigNumber,
		timestamp: number,
		receipt: string,
		uuid: string
	): Promise<void>;
	storeUserSwapToBan(swap: SwapWBANToBan): Promise<void>;
	swapToBanWasAlreadyDone(swap: SwapWBANToBan): Promise<boolean>;

	getLastBlockchainBlockProcessed(): Promise<number>;
	setLastBlockchainBlockProcessed(block: number): Promise<void>;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getDeposits(banAddress: string): Promise<Array<any>>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getWithdrawals(banAddress: string): Promise<Array<any>>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getSwaps(blockchainAddress: string, banAddress: string): Promise<Array<any>>;

	isFreeSwapAlreadyDone(from: string): Promise<boolean>;
	storeFreeSwap(from: string, txnId: string): Promise<void>;
}

export { UsersDepositsStorage };

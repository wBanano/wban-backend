import { BigNumber } from "ethers";
import SwapWBANToBan from "../models/operations/SwapWBANToBan";

interface UsersDepositsStorage {
	getUserAvailableBalance(from: string): Promise<BigNumber>;
	lockBalance(from: string): Promise<void>;
	unlockBalance(from: string): Promise<void>;
	isBalanceLocked(from: string): Promise<boolean>;

	hasPendingClaim(banAddress: string): Promise<boolean>;
	storePendingClaim(banAddress: string, bscAddress: string): Promise<boolean>;
	isClaimed(banAddress: string): Promise<boolean>;
	hasClaim(banAddress: string, bscAddress: string): Promise<boolean>;
	confirmClaim(banAddress: string): Promise<boolean>;

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
		amount: BigNumber,
		timestamp: number,
		receipt: string,
		uuid: string
	): Promise<void>;
	storeUserSwapToBan(swap: SwapWBANToBan): Promise<void>;
	swapToBanWasAlreadyDone(swap: SwapWBANToBan): Promise<boolean>;

	getLastBSCBlockProcessed(): Promise<number>;
	setLastBSCBlockProcessed(block: number): Promise<void>;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getDeposits(banAddress: string): Promise<Array<any>>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getWithdrawals(banAddress: string): Promise<Array<any>>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getSwaps(bscAddress: string, banAddress: string): Promise<Array<any>>;
}

export { UsersDepositsStorage };

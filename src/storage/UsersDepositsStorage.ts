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
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void>;
	storeUserWithdrawal(
		from: string,
		amount: BigNumber,
		date: string
	): Promise<void>;
	storeUserSwap(from: string, amount: BigNumber, hash: string): Promise<void>;
	containsUserDepositTransaction(from: string, hash: string): Promise<boolean>;
	containsUserWithdrawalRequest(from: string, date: string): Promise<boolean>;

	getLastBSCBlockProcessed(): Promise<number>;
	setLastBSCBlockProcessed(block: number): Promise<void>;
	storeUserSwapToBan(swap: SwapWBANToBan): Promise<void>;
	swapToBanWasAlreadyDone(swap: SwapWBANToBan): Promise<boolean>;
}

export { UsersDepositsStorage };

import { BigNumber } from "ethers";
import SwapToBanEvent from "../models/events/SwapToBanEvent";

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
		sig: string
	): Promise<void>;
	storeUserSwap(from: string, amount: BigNumber, hash: string): Promise<void>;
	containsTransaction(from: string, hash: string): Promise<boolean>;

	getLastBSCBlockProcessed(): Promise<number>;
	setLastBSCBlockProcessed(block: number): Promise<void>;
	storeUserSwapToBan(event: SwapToBanEvent): Promise<void>;
	swapToBanWasAlreadyDone(event: SwapToBanEvent): Promise<boolean>;
}

export { UsersDepositsStorage };

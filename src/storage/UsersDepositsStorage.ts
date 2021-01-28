import { BigNumber } from "ethers";

interface UsersDepositsStorage {
	getUserAvailableBalance(from: string): Promise<BigNumber>;

	hasPendingClaim(banAddress: string): Promise<boolean>;
	storePendingClaim(banAddress: string, bscAddress: string): Promise<boolean>;
	hasClaim(banAddress: string): Promise<boolean>;
	storeClaim(banAddress: string): Promise<boolean>;

	storeUserDeposit(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void>;
	storeUserSwap(from: string, amount: BigNumber): Promise<void>;
	containsTransaction(from: string, hash: string): Promise<boolean>;
}

export { UsersDepositsStorage };

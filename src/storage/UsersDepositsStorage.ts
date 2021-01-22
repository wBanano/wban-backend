import { BigNumber } from "ethers";

interface UsersDepositsStorage {
	getUserAvailableBalance(from: string): Promise<BigNumber>;
	storeUserDeposit(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void>;
	storeUserSwap(from: string, amount: BigNumber): Promise<void>;
	containsTransaction(from: string, hash: string): Promise<boolean>;
}

export { UsersDepositsStorage };

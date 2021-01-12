interface UsersDepositsStorage {
	getUserAvailableBalance(from: string): Promise<number>;
	storeUserDeposit(from: string, amount: number, hash: string): Promise<void>;
}

export { UsersDepositsStorage };

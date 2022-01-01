type BlacklistRecord = {
	address: string;
	alias: string;
	type: string;
};

interface BananoWalletsBlacklist {
	getBlacklistedWallets(): Promise<Array<BlacklistRecord>>;
	/**
	 * Check if a BAN wallet/address is blacklisted.
	 * Returns a BlacklistRecord if address is blacklisted, undefined otherwise
	 * @param banWallet the BAN wallet address to check with the blacklist
	 */
	isBlacklisted(banWallet: string): Promise<BlacklistRecord | undefined>;
}

export { BananoWalletsBlacklist, BlacklistRecord };

interface TokenPricer {
	getPriceInUSD(): Promise<number>;
}

export { TokenPricer };

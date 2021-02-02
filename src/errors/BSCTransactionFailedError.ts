import config from "../config";

class BSCTransactionFailedError extends Error {
	public hash: string;

	constructor(hash: string, message: string) {
		super(message);
		this.hash = hash;
		Object.setPrototypeOf(this, BSCTransactionFailedError.prototype);
	}

	getTransactionUrl(): string {
		return `${config.BinanceSmartChainBlockExplorerUrl}/tx/${this.hash}`;
	}
}

export default BSCTransactionFailedError;

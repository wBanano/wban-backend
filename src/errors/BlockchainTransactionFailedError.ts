import config from "../config";

class BlockchainTransactionFailedError extends Error {
	public hash: string;

	constructor(hash: string, message: string) {
		super(message);
		this.hash = hash;
		Object.setPrototypeOf(this, BlockchainTransactionFailedError.prototype);
	}

	getTransactionUrl(): string {
		return `${config.BlockchainBlockExplorerUrl}/tx/${this.hash}`;
	}
}

export default BlockchainTransactionFailedError;

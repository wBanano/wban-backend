import { BigNumber, ethers } from "ethers";

class InsufficientHotWalletBalanceError extends Error {
	constructor(expected: BigNumber, available: BigNumber) {
		super(
			`Hot wallet balance of ${ethers.utils.formatEther(
				available
			)} BAN is not enough to proceed with a withdrawal of ${ethers.utils.formatEther(
				expected
			)} BAN.`
		);
		Object.setPrototypeOf(this, InsufficientHotWalletBalanceError.prototype);
	}
}

export default InsufficientHotWalletBalanceError;

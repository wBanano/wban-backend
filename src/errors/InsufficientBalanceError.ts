class InsufficientBalanceError extends Error {
	constructor(message: string) {
		super(message);
		Object.setPrototypeOf(this, InsufficientBalanceError.prototype);
	}
}

export default InsufficientBalanceError;

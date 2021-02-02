class InsufficientBalanceError extends Error {
	constructor() {
		super();
		Object.setPrototypeOf(this, InsufficientBalanceError.prototype);
	}
}

export default InsufficientBalanceError;

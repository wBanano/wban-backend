class BalanceLockedError extends Error {
	constructor() {
		super();
		Object.setPrototypeOf(this, BalanceLockedError.prototype);
	}
}

export default BalanceLockedError;

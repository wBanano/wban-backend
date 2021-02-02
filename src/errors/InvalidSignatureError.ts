class InvalidSignatureError extends Error {
	constructor() {
		super();
		Object.setPrototypeOf(this, InvalidSignatureError.prototype);
	}
}

export default InvalidSignatureError;

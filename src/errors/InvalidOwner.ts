class InvalidOwner extends Error {
	constructor() {
		super();
		Object.setPrototypeOf(this, InvalidOwner.prototype);
	}
}

export default InvalidOwner;

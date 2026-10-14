class LedgerMovedToPostgresError extends Error {
	constructor(markerKey: string) {
		super(
			`The ledger of this chain moved to Postgres (${markerKey} is set in Redis), refusing to use the Redis ledger`
		);
		Object.setPrototypeOf(this, LedgerMovedToPostgresError.prototype);
	}
}

export default LedgerMovedToPostgresError;

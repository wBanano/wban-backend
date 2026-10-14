type ErrorShape = {
	name?: string;
	message?: string;
	code?: string;
	errno?: number;
	severity?: string;
	cause?: unknown;
};

const CONSTRAINT_VIOLATION = /^23/;

export default function safeErrorMessage(err: unknown): string {
	const error = (err ?? {}) as ErrorShape;
	if (error.cause) {
		return safeErrorMessage(error.cause);
	}
	if (typeof error.errno === "number" || error.code?.startsWith("E")) {
		return `connection failed (${error.code ?? error.name})`;
	}
	if (error.severity && !CONSTRAINT_VIOLATION.test(error.code ?? "")) {
		return `database error ${error.code}`;
	}
	return error.message ?? String(err);
}

type ErrorShape = {
	name?: string;
	message?: string;
	code?: string | number;
	errno?: number;
	severity?: string;
	reason?: string;
	error?: unknown;
	cause?: unknown;
};

const CONSTRAINT_VIOLATION = /^23/;

export default function safeErrorMessage(err: unknown): string {
	const error = (err ?? {}) as ErrorShape;
	if (error.cause) {
		return safeErrorMessage(error.cause);
	}
	if (typeof error.reason === "string" && typeof error.code === "string") {
		const inner = error.error ? `, ${safeErrorMessage(error.error)}` : "";
		return `chain RPC ${error.code}: ${error.reason}${inner}`;
	}
	const code = typeof error.code === "string" ? error.code : undefined;
	if (typeof error.errno === "number" || code?.startsWith("E")) {
		return `connection failed (${error.code ?? error.name})`;
	}
	if (error.severity && !CONSTRAINT_VIOLATION.test(code ?? "")) {
		return `database error ${error.code}`;
	}
	return error.message ?? String(err);
}

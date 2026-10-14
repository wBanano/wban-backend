import chai from "chai";
import safeErrorMessage from "../../../src/tools/migration/safeErrorMessage";

const { expect } = chai;

describe("Safe error messages", () => {
	it("reduces connection errors to their code", () => {
		const err = Object.assign(
			new Error("getaddrinfo ENOTFOUND pg.secret-host"),
			{
				code: "ENOTFOUND",
				errno: -3008,
			}
		);
		expect(safeErrorMessage(err)).to.equal("connection failed (ENOTFOUND)");
		expect(safeErrorMessage({ cause: err })).to.equal(
			"connection failed (ENOTFOUND)"
		);
	});

	it("reduces database errors to their code, except constraint violations", () => {
		expect(
			safeErrorMessage({
				severity: "FATAL",
				code: "28P01",
				message: 'password authentication failed for user "someone"',
			})
		).to.equal("database error 28P01");
		expect(
			safeErrorMessage({
				severity: "ERROR",
				code: "23505",
				message: "duplicate key value violates unique constraint",
			})
		).to.equal("duplicate key value violates unique constraint");
	});

	it("keeps the tool's own messages", () => {
		expect(safeErrorMessage(new Error("Refusing to write"))).to.equal(
			"Refusing to write"
		);
		expect(safeErrorMessage("plain")).to.equal("plain");
	});
});

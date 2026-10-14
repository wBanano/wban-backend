import chai from "chai";
import { ethers } from "ethers";
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

	it("keeps the RPC URL out of chain RPC errors", () => {
		const logger = new ethers.utils.Logger("web/5.7.1");
		const url = "https://rpc.example/SECRET-KEY";
		const serverError = logger.makeError(
			"processing response error",
			ethers.utils.Logger.errors.SERVER_ERROR,
			{ error: new Error("Backend unavailable"), requestMethod: "POST", url }
		);
		expect(safeErrorMessage(serverError)).to.equal(
			"chain RPC SERVER_ERROR: processing response error, Backend unavailable"
		);
		const unreachable = logger.makeError(
			"missing response",
			ethers.utils.Logger.errors.SERVER_ERROR,
			{
				error: Object.assign(
					new Error("getaddrinfo ENOTFOUND SECRET-KEY.rpc"),
					{
						code: "ENOTFOUND",
						errno: -3008,
					}
				),
				url,
			}
		);
		expect(safeErrorMessage(unreachable)).to.equal(
			"chain RPC SERVER_ERROR: missing response, connection failed (ENOTFOUND)"
		);
	});

	it("keeps the tool's own messages", () => {
		expect(safeErrorMessage(new Error("Refusing to write"))).to.equal(
			"Refusing to write"
		);
		expect(safeErrorMessage("plain")).to.equal("plain");
	});
});

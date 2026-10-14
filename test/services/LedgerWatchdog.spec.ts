import chai from "chai";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import LedgerWatchdog from "../../src/services/LedgerWatchdog";
import { LedgerHealth } from "../../src/storage/postgres/LedgerHealth";

const { expect } = chai;
chai.use(sinonChai);

describe("Ledger watchdog", () => {
	it("checks the ledger health on start and survives a failing check", async () => {
		const health = sinon.stubInterface<LedgerHealth>();
		health.report.onFirstCall().rejects(new Error("database down"));
		health.report.resolves({
			stuckWithdrawals: [
				{
					id: 1,
					banAddress: "ban_1alice",
					amount: "1",
					requestTimestamp: 0,
					reservedAt: new Date(0),
				},
			],
			balanceMismatches: [
				{ banAddress: "ban_1bob", balance: "2", expected: "1" },
			],
		});
		const watchdog = new LedgerWatchdog(health);
		watchdog.start();
		watchdog.stop();
		await watchdog.check();
		expect(health.report).to.have.been.calledTwice;
	});
});

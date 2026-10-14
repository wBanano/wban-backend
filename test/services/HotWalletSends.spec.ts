import chai from "chai";
import { ethers } from "ethers";
import {
	AccountHistoryEntry,
	matchingSends,
	rawAmount,
} from "../../src/services/HotWalletSends";

const { expect } = chai;

describe("Hot wallet sends", () => {
	const reservedAt = new Date("2026-10-14T12:00:00Z");
	const reservation = {
		id: 1,
		banAddress: "ban_1alice",
		amount: ethers.utils.parseEther("3").toString(),
		requestTimestamp: reservedAt.getTime(),
		reservedAt,
	};
	const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1_000);
	const send = (overrides: Partial<AccountHistoryEntry>): AccountHistoryEntry => ({
		type: "send",
		account: "ban_1alice",
		amount: rawAmount(reservation.amount),
		hash: "MATCH",
		localTimestamp: at("2026-10-14T12:00:05Z"),
		...overrides,
	});

	it("converts ledger amounts to Banano raw", () => {
		expect(rawAmount(ethers.utils.parseEther("1").toString())).to.equal(
			`1${"0".repeat(29)}`
		);
	});

	it("keeps sends to the account of the reserved amount since the reservation", () => {
		const history = [
			send({}),
			send({ hash: "RECEIVE", type: "receive" }),
			send({ hash: "OTHER_ACCOUNT", account: "ban_1bob" }),
			send({ hash: "OTHER_AMOUNT", amount: rawAmount("1") }),
			send({ hash: "TOO_OLD", localTimestamp: at("2026-10-14T11:58:00Z") }),
			send({ hash: "CLOCK_SLACK", localTimestamp: at("2026-10-14T11:59:30Z") }),
		];
		expect(matchingSends(history, reservation).map((s) => s.hash)).to.deep.equal([
			"MATCH",
			"CLOCK_SLACK",
		]);
	});
});

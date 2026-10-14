import chai from "chai";
import { ethers } from "ethers";
import {
	emptySnapshot,
	LedgerSnapshot,
} from "../../../src/tools/migration/snapshot";
import { planMigration } from "../../../src/tools/migration/plan";

const { expect } = chai;

const BAN = (amount: string) => ethers.utils.parseEther(amount).toString();
const ALICE = "ban_1alice";
const BOB = "ban_1bob";
const WALLET = "0xabc0000000000000000000000000000000000001";
const T0 = 1_700_000_000_000;

function deposit(
	snapshot: LedgerSnapshot,
	ban: string,
	hash: string,
	amount: string,
	at = T0
) {
	const members = snapshot.history.deposit.get(ban) ?? [];
	members.push({ member: hash, score: at });
	snapshot.history.deposit.set(ban, members);
	snapshot.audits.set(hash, {
		type: "deposit",
		hash,
		amount,
		timestamp: String(at),
	});
}

function unwrap(
	snapshot: LedgerSnapshot,
	hash: string,
	amount: string,
	score: number,
	banAddress?: string
) {
	snapshot.history.swap_to_ban.set(WALLET, [{ member: hash, score }]);
	snapshot.audits.set(hash, {
		type: "swap-to-ban",
		hash,
		...(banAddress ? { banAddress } : {}),
		amount,
		timestamp: String(score),
	});
}

const kinds = (plan: ReturnType<typeof planMigration>) =>
	plan.blocking.map((issue) => issue.kind);

describe("Migration plan", () => {
	let snapshot: LedgerSnapshot;

	beforeEach(() => {
		snapshot = emptySnapshot();
	});

	it("plans accounts and entries with no discrepancy when history matches", () => {
		deposit(snapshot, ALICE, "D1", BAN("10"));
		snapshot.history.withdrawal.set(ALICE, [{ member: "W1", score: T0 + 1 }]);
		snapshot.audits.set("W1", {
			type: "withdrawal",
			hash: "W1",
			amount: BAN("3"),
			timestamp: String(T0 + 1),
		});
		snapshot.balances.set(ALICE, BAN("7"));
		const plan = planMigration(snapshot);
		expect(plan.blocking).to.deep.equal([]);
		expect(plan.discrepancies).to.deep.equal([]);
		expect(plan.accounts).to.deep.equal([
			{ banAddress: ALICE, balance: BAN("7") },
		]);
		expect(
			plan.entries.map((e) => [e.kind, e.ref, e.status, e.requestTimestamp])
		).to.deep.equal([
			["deposit", "D1", null, null],
			["withdrawal", "W1", "sent", T0 + 1],
		]);
	});

	it("keeps the stored balance and records how it differs from history", () => {
		deposit(snapshot, ALICE, "D1", BAN("10"));
		snapshot.balances.set(ALICE, BAN("-1"));
		deposit(snapshot, BOB, "D2", BAN("2"));
		const plan = planMigration(snapshot);
		expect(plan.accounts).to.deep.include({
			banAddress: ALICE,
			balance: BAN("-1"),
		});
		expect(plan.accounts).to.deep.include({ banAddress: BOB, balance: "0" });
		expect(plan.discrepancies.map((d) => [d.kind, d.banAddress])).to.deep.equal(
			[
				["negative_balance", ALICE],
				["balance_mismatch", ALICE],
				["balance_mismatch", BOB],
			]
		);
		expect(plan.blocking).to.deep.equal([]);
	});

	it("blocks on history without an audit hash and records orphan audits", () => {
		snapshot.history.deposit.set(ALICE, [{ member: "D1", score: T0 }]);
		snapshot.audits.set("ORPHAN", { type: "deposit", amount: "1" });
		const plan = planMigration(snapshot);
		expect(kinds(plan)).to.deep.equal(["missing_audit"]);
		expect(plan.discrepancies.map((d) => [d.kind, d.redisKey])).to.deep.include(
			["orphan_audit", "audit:ORPHAN"]
		);
	});

	it("blocks on duplicate refs and duplicate withdrawal requests", () => {
		deposit(snapshot, ALICE, "D1", BAN("1"));
		deposit(snapshot, BOB, "D1", BAN("1"));
		snapshot.history.withdrawal.set(ALICE, [
			{ member: "W1", score: T0 },
			{ member: "W2", score: T0 },
		]);
		["W1", "W2"].forEach((hash) =>
			snapshot.audits.set(hash, {
				type: "withdrawal",
				hash,
				amount: "1",
				timestamp: String(T0),
			})
		);
		expect(kinds(planMigration(snapshot))).to.have.members([
			"duplicate_ref",
			"duplicate_withdrawal_request",
		]);
	});

	it("counts zero amounts and blocks on them", () => {
		deposit(snapshot, ALICE, "D0", "0");
		const plan = planMigration(snapshot);
		expect(plan.stats.zeroAmounts).to.equal(1);
		expect(kinds(plan)).to.deep.equal(["zero_amount"]);
	});

	it("keeps the Redis rendering of an unwrap stored in milliseconds", () => {
		unwrap(snapshot, "0xold", BAN("1"), T0, ALICE);
		const plan = planMigration(snapshot);
		const [entry] = plan.entries;
		expect(entry.occurredAt.getTime()).to.equal(T0);
		expect(entry.legacyAudit).to.deep.equal(snapshot.audits.get("0xold"));
		expect(plan.stats.legacyRows).to.deep.equal({ timestamp: 1 });
		expect(plan.discrepancies.map((d) => d.kind)).to.include(
			"timestamp_oddity"
		);
	});

	it("needs no legacy rendering for a current unwrap or a wrap without blockchain address", () => {
		unwrap(snapshot, "0xnew", BAN("1"), T0 * 1_000, ALICE);
		snapshot.history.swap_to_wban.set(ALICE, [
			{ member: "0xreceipt", score: T0 },
		]);
		snapshot.audits.set("0xreceipt", {
			type: "swap-to-wban",
			receipt: "0xreceipt",
			uuid: "1",
			amount: BAN("1"),
			timestamp: String(T0),
		});
		const plan = planMigration(snapshot);
		expect(plan.stats.legacyRows).to.deep.equal({});
		expect(plan.entries.map((e) => e.occurredAt.getTime())).to.deep.equal([
			T0,
			T0,
		]);
	});

	it("blocks on an unwrap without BAN address unless the chain gave it", () => {
		unwrap(snapshot, "0xold", BAN("1"), T0 * 1_000);
		expect(kinds(planMigration(snapshot))).to.deep.equal([
			"unwrap_without_ban_address",
		]);
		const plan = planMigration(snapshot, {
			recoveredBanAddresses: new Map([["0xold", ALICE]]),
		});
		expect(plan.blocking).to.deep.equal([]);
		expect(plan.entries[0].banAddress).to.equal(ALICE);
		expect(plan.entries[0].legacyAudit).to.not.equal(undefined);
		expect(plan.stats).to.include({
			unwrapsMissingBanAddress: 1,
			unwrapsRecovered: 1,
		});
	});

	it("migrates confirmed claims without a confirmation time and only clean pending ones", () => {
		snapshot.confirmedClaims.push(
			{ banAddress: ALICE, blockchainAddress: WALLET },
			{ banAddress: BOB, blockchainAddress: WALLET }
		);
		snapshot.pendingClaims.push(
			{ banAddress: ALICE, blockchainAddress: WALLET },
			{ banAddress: "ban_1carol", blockchainAddress: "0x1" },
			{ banAddress: "ban_1carol", blockchainAddress: "0x2" },
			{ banAddress: "ban_1dave", blockchainAddress: "0x3" }
		);
		const plan = planMigration(snapshot);
		expect(plan.claims).to.deep.equal([
			{
				banAddress: ALICE,
				blockchainAddress: WALLET,
				status: "confirmed",
				confirmedAt: null,
			},
			{
				banAddress: BOB,
				blockchainAddress: WALLET,
				status: "confirmed",
				confirmedAt: null,
			},
			{ banAddress: "ban_1dave", blockchainAddress: "0x3", status: "pending" },
		]);
		expect(plan.stats).to.include({
			blockchainAddressesWithSeveralClaims: 1,
			banAddressesWithSeveralClaims: 0,
			pendingClaimsMigrated: 1,
		});
		expect(plan.discrepancies.map((d) => d.kind)).to.deep.equal([
			"pending_claim_superseded",
			"pending_claims_conflict",
			"pending_claims_conflict",
		]);
	});

	it("blocks on unknown keys, a set marker and an invalid scan state", () => {
		snapshot.unknownKeys.push("ban-balances");
		snapshot.marker = "postgres";
		snapshot.lastBlockProcessed = "abc";
		snapshot.unparsed.push({ key: "deposits:ban_1x", reason: "WRONGTYPE" });
		expect(kinds(planMigration(snapshot))).to.have.members([
			"unparsed_key",
			"ledger_marker",
			"unknown_key",
			"invalid_scan_state",
		]);
	});

	it("records unknown keys instead of blocking when asked to", () => {
		snapshot.unknownKeys.push("ban-balances");
		snapshot.lastBlockProcessed = "42";
		const plan = planMigration(snapshot, { skipUnknownKeys: true });
		expect(plan.blocking).to.deep.equal([]);
		expect(plan.discrepancies).to.deep.equal([
			{ kind: "unknown_key", redisKey: "ban-balances" },
		]);
		expect(plan.lastBlockProcessed).to.equal(42);
	});
});

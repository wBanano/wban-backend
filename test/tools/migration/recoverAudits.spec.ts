import chai from "chai";
import { BigNumber, ethers } from "ethers";
// eslint-disable-next-line camelcase
import { WBANToken__factory } from "wban-smart-contract";
import {
	ATTRIBUTED,
	ATTRIBUTED_IN_HISTORY,
	ChainLookups,
	WRAP_NOT_RECOVERABLE,
	recoverFromChain,
} from "../../../src/tools/migration/recoverAudits";
import {
	BananoBlock,
	bananoNodeUrl,
} from "../../../src/tools/migration/bananoNode";
import {
	emptySnapshot,
	LedgerSnapshot,
} from "../../../src/tools/migration/snapshot";

const { expect } = chai;

const ALICE = `ban_1${"a".repeat(59)}`;
const BOB = `ban_1${"b".repeat(59)}`;
const HOT = `ban_3${"h".repeat(59)}`;
const CONTRACT = "0x00000000000000000000000000000000000000aa";
const WALLET = "0xabc0000000000000000000000000000000000001";
const T0 = 1_700_000_000_000;
const RAW_PER_BAN = BigNumber.from(10).pow(29);
const LEDGER_PER_BAN = BigNumber.from(10).pow(18);

const send = (
	from: string,
	to: string,
	ban: number,
	overrides: Partial<BananoBlock> = {}
): BananoBlock => ({
	account: from,
	amount: RAW_PER_BAN.mul(ban).toString(),
	confirmed: "true",
	subtype: "send",
	linkAsAccount: to,
	...overrides,
});

function swapToBanLog(from: string, banAddress: string, amount: string) {
	const wban = WBANToken__factory.createInterface();
	const encoded = wban.encodeEventLog(wban.getEvent("SwapToBan"), [
		from,
		banAddress,
		amount,
	]);
	return { address: CONTRACT, ...encoded } as ethers.providers.Log;
}

function lookups(
	blocks: Record<string, BananoBlock>,
	transactions: Record<string, ethers.providers.Log[]> = {},
	batches: number[] = []
): ChainLookups {
	return {
		node: {
			blocksInfo: async (hashes) => {
				batches.push(hashes.length);
				return new Map(
					hashes
						.filter((hash) => blocks[hash])
						.map((hash) => [hash, blocks[hash]])
				);
			},
		},
		hotWallet: HOT.toUpperCase(),
		receipts: {
			getTransactionReceipt: async (hash) =>
				transactions[hash]
					? ({
							logs: transactions[hash],
					  } as ethers.providers.TransactionReceipt)
					: null,
		},
		contractAddress: CONTRACT,
	};
}

function history(
	snapshot: LedgerSnapshot,
	kind: keyof LedgerSnapshot["history"],
	owner: string,
	member: string,
	score = T0
) {
	const members = snapshot.history[kind].get(owner) ?? [];
	members.push({ member, score });
	snapshot.history[kind].set(owner, members);
}

describe("History recovery from the chains", () => {
	let snapshot: LedgerSnapshot;

	beforeEach(() => {
		snapshot = emptySnapshot();
	});

	it("recovers deposits and withdrawals that strictly match the hot wallet", async () => {
		history(snapshot, "deposit", ALICE, "D1");
		history(snapshot, "withdrawal", ALICE, "W1");
		history(snapshot, "deposit", ALICE, "KEPT");
		snapshot.audits.set("KEPT", { type: "deposit", amount: "1" });
		const { audits } = await recoverFromChain(
			lookups({ D1: send(ALICE, HOT, 5), W1: send(HOT, ALICE, 2) }),
			snapshot
		);
		expect([...audits.recovered]).to.deep.equal([
			[
				"deposit:D1",
				{
					banAddress: ALICE,
					amount: LEDGER_PER_BAN.mul(5).toString(),
					source: "banano_node",
				},
			],
			[
				"withdrawal:W1",
				{
					banAddress: ALICE,
					amount: LEDGER_PER_BAN.mul(2).toString(),
					source: "banano_node",
				},
			],
		]);
		expect(audits.unrecovered.size).to.equal(0);
	});

	it("records anything that doesn't match exactly instead of recovering it", async () => {
		const blocks: Record<string, BananoBlock> = {
			UNCONFIRMED: send(ALICE, HOT, 1, { confirmed: "false" }),
			RECEIVE: send(ALICE, HOT, 1, { subtype: "receive" }),
			ELSEWHERE: send(ALICE, BOB, 1),
			OTHER: send(BOB, HOT, 1),
			DUST: send(ALICE, HOT, 1, { amount: "100000000001" }),
			ZERO: send(ALICE, HOT, 0),
			BACKWARDS: send(ALICE, HOT, 1),
		};
		["MISSING", ...Object.keys(blocks)]
			.filter((hash) => hash !== "BACKWARDS")
			.forEach((hash) => history(snapshot, "deposit", ALICE, hash));
		history(snapshot, "withdrawal", ALICE, "BACKWARDS");
		const { audits } = await recoverFromChain(lookups(blocks), snapshot);
		expect(audits.recovered.size).to.equal(0);
		expect(
			Object.fromEntries(
				[...audits.unrecovered].map(([key, { reason }]) => [key, reason])
			)
		).to.deep.equal({
			"deposit:MISSING": "block not found on the node",
			"deposit:UNCONFIRMED": "block not confirmed",
			"deposit:RECEIVE": "not a send block",
			"deposit:ELSEWHERE": "not sent to the hot wallet",
			"deposit:OTHER": "another account's block",
			"deposit:DUST": "amount is not a whole number of ledger units",
			"deposit:ZERO": "amount is 0",
			"withdrawal:BACKWARDS": "not sent by the hot wallet",
		});
	});

	it("asks the node in batches", async () => {
		Array.from({ length: 450 }, (_, i) => `D${i}`).forEach((hash) =>
			history(snapshot, "deposit", ALICE, hash)
		);
		const batches: number[] = [];
		await recoverFromChain(lookups({}, {}, batches), snapshot);
		expect(batches).to.deep.equal([200, 200, 50]);
	});

	it("recovers unwraps from a single SwapToBan event and records wraps", async () => {
		const amount = LEDGER_PER_BAN.mul(3).toString();
		history(snapshot, "swap_to_ban", WALLET, "0xone", T0 * 1_000);
		history(snapshot, "swap_to_ban", WALLET, "0xtwo", T0 * 1_000);
		history(snapshot, "swap_to_ban", WALLET, "0xbad", T0 * 1_000);
		history(snapshot, "swap_to_wban", ALICE, "0xreceipt");
		const { audits } = await recoverFromChain(
			lookups(
				{},
				{
					"0xone": [swapToBanLog(WALLET, ALICE.toUpperCase(), amount)],
					"0xtwo": [
						swapToBanLog(WALLET, ALICE, amount),
						swapToBanLog(WALLET, BOB, amount),
					],
					"0xbad": [swapToBanLog(WALLET, "ban_1nope", amount)],
				}
			),
			snapshot
		);
		expect([...audits.recovered]).to.deep.equal([
			[
				"swap_to_ban:0xone",
				{ banAddress: ALICE, amount, source: "swap_to_ban_event" },
			],
		]);
		expect(
			Object.fromEntries(
				[...audits.unrecovered].map(([key, { reason }]) => [key, reason])
			)
		).to.deep.equal({
			"swap_to_ban:0xtwo": "not exactly one SwapToBan event from that address",
			"swap_to_ban:0xbad": "SwapToBan names no valid BAN address",
			"swap_to_wban:0xreceipt": WRAP_NOT_RECOVERABLE,
		});
	});

	it("attributes unreferenced deposit and withdrawal audits to their account", async () => {
		const audit = (type: string, ban: number) => ({
			type,
			amount: LEDGER_PER_BAN.mul(ban).toString(),
		});
		snapshot.audits.set("OD", audit("deposit", 4));
		snapshot.audits.set("OW", audit("withdrawal", 1));
		snapshot.audits.set("OFF", audit("deposit", 9));
		snapshot.audits.set("od2", audit("deposit", 2));
		snapshot.audits.set("OWRAP", audit("swap-to-wban", 1));
		history(snapshot, "deposit", BOB, "OD2");
		const { orphans } = await recoverFromChain(
			lookups({
				OD: send(ALICE, HOT, 4),
				OW: send(HOT, BOB, 1),
				OFF: send(ALICE, HOT, 8),
				od2: send(BOB, HOT, 2),
			}),
			snapshot
		);
		expect(Object.fromEntries(orphans)).to.deep.equal({
			OD: { banAddress: ALICE, outcome: ATTRIBUTED },
			OW: { banAddress: BOB, outcome: ATTRIBUTED },
			OFF: {
				banAddress: ALICE,
				outcome: "amount differs from the audit",
				detail: `chain ${LEDGER_PER_BAN.mul(8)}, audit ${LEDGER_PER_BAN.mul(
					9
				)}`,
			},
			od2: { banAddress: BOB, outcome: ATTRIBUTED_IN_HISTORY },
		});
	});

	it("accepts the node address with or without a scheme", () => {
		expect(bananoNodeUrl("10.0.32.10:7072")).to.equal("http://10.0.32.10:7072");
		expect(bananoNodeUrl("http://node:7072")).to.equal("http://node:7072");
	});
});

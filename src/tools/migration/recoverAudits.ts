import { BigNumber } from "ethers";
import { HistoryKind, LedgerSnapshot } from "./snapshot";
import { BananoBlock, BananoNode } from "./bananoNode";
import { TransactionReceipts, swapToBanEvents } from "./recoverBanAddresses";

export type RecoverySource = "banano_node" | "swap_to_ban_event";

export type MissingAudit = {
	kind: HistoryKind;
	owner: string;
	member: string;
	score: number;
};

export type RecoveredAudit = {
	banAddress: string;
	amount: string;
	source: RecoverySource;
};

export type RecoveryFailure = { reason: string; detail?: string };

export type AuditRecovery = {
	recovered: Map<string, RecoveredAudit>;
	unrecovered: Map<string, RecoveryFailure>;
};

export type OrphanAttribution = {
	banAddress?: string;
	outcome: string;
	detail?: string;
};

export type ChainLookups = {
	node: BananoNode;
	hotWallet: string;
	receipts: TransactionReceipts;
	contractAddress: string;
};

export const WRAP_NOT_RECOVERABLE =
	"no contract event ties a mint to its receipt";
export const ATTRIBUTED = "matched, not in that account's history";
export const ATTRIBUTED_IN_HISTORY =
	"matched, already in that account's history";

const RAW_PER_LEDGER_UNIT = BigNumber.from(10).pow(11);
const NODE_BATCH = 200;
const BAN_ADDRESS = /^ban_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

type TransferKind = "deposit" | "withdrawal";

type Send = { from: string; to: string; amount: string };

export const recoveryKey = (kind: HistoryKind, member: string): string =>
	`${kind}:${member}`;

const isEmpty = (audit: Record<string, string> | undefined) =>
	!audit || Object.keys(audit).length === 0;

const isTransfer = (kind: HistoryKind): kind is TransferKind =>
	kind === "deposit" || kind === "withdrawal";

export function missingAudits(snapshot: LedgerSnapshot): MissingAudit[] {
	return (Object.keys(snapshot.history) as HistoryKind[]).flatMap((kind) =>
		[...snapshot.history[kind].entries()].flatMap(([owner, members]) =>
			members
				.filter(({ member }) => isEmpty(snapshot.audits.get(member)))
				.map(({ member, score }) => ({ kind, owner, member, score }))
		)
	);
}

export function unreferencedAudits(
	snapshot: LedgerSnapshot
): [string, Record<string, string>][] {
	const referenced = new Set(
		Object.values(snapshot.history).flatMap((owners) =>
			[...owners.values()].flatMap((members) =>
				members.map(({ member }) => member)
			)
		)
	);
	return [...snapshot.audits.entries()].filter(([ref]) => !referenced.has(ref));
}

async function blocksOf(
	node: BananoNode,
	hashes: string[]
): Promise<Map<string, BananoBlock>> {
	const blocks = new Map<string, BananoBlock>();
	for (let start = 0; start < hashes.length; start += NODE_BATCH) {
		// eslint-disable-next-line no-await-in-loop
		const batch = await node.blocksInfo(
			hashes.slice(start, start + NODE_BATCH)
		);
		batch.forEach((block, hash) => blocks.set(hash, block));
	}
	return blocks;
}

function sendOf(block: BananoBlock | undefined): Send | RecoveryFailure {
	if (!block) {
		return { reason: "block not found on the node" };
	}
	if (block.confirmed !== "true") {
		return { reason: "block not confirmed" };
	}
	if (block.subtype !== "send") {
		return { reason: "not a send block", detail: block.subtype };
	}
	const raw = BigNumber.from(block.amount);
	if (!raw.mod(RAW_PER_LEDGER_UNIT).isZero()) {
		return {
			reason: "amount is not a whole number of ledger units",
			detail: `${block.amount} raw`,
		};
	}
	if (raw.isZero()) {
		return { reason: "amount is 0" };
	}
	return {
		from: block.account.toLowerCase(),
		to: (block.linkAsAccount ?? "").toLowerCase(),
		amount: raw.div(RAW_PER_LEDGER_UNIT).toString(),
	};
}

const isFailure = (
	value: Send | RecoveredAudit | RecoveryFailure
): value is RecoveryFailure => "reason" in value;

function counterpartyOf(kind: TransferKind, send: Send): string {
	return kind === "deposit" ? send.to : send.from;
}

function accountOf(kind: TransferKind, send: Send): string {
	return kind === "deposit" ? send.from : send.to;
}

function hotWalletMismatch(kind: TransferKind): string {
	return kind === "deposit"
		? "not sent to the hot wallet"
		: "not sent by the hot wallet";
}

function recoverTransfer(
	missing: MissingAudit & { kind: TransferKind },
	block: BananoBlock | undefined,
	hotWallet: string
): RecoveredAudit | RecoveryFailure {
	const send = sendOf(block);
	if (isFailure(send)) {
		return send;
	}
	const counterparty = counterpartyOf(missing.kind, send);
	if (counterparty !== hotWallet) {
		return { reason: hotWalletMismatch(missing.kind), detail: counterparty };
	}
	const account = accountOf(missing.kind, send);
	if (account !== missing.owner) {
		return { reason: "another account's block", detail: account };
	}
	return { banAddress: account, amount: send.amount, source: "banano_node" };
}

async function recoverUnwrap(
	lookups: ChainLookups,
	missing: MissingAudit
): Promise<RecoveredAudit | RecoveryFailure> {
	const receipt = await lookups.receipts.getTransactionReceipt(missing.member);
	if (!receipt) {
		return { reason: "transaction not found" };
	}
	const events = swapToBanEvents(
		receipt,
		lookups.contractAddress,
		missing.owner
	);
	if (events.length !== 1) {
		return {
			reason: "not exactly one SwapToBan event from that address",
			detail: `${events.length} events`,
		};
	}
	const [{ banAddress, amount }] = events;
	if (!BAN_ADDRESS.test(banAddress)) {
		return {
			reason: "SwapToBan names no valid BAN address",
			detail: banAddress,
		};
	}
	if (BigNumber.from(amount).isZero()) {
		return { reason: "amount is 0" };
	}
	return { banAddress, amount, source: "swap_to_ban_event" };
}

function attributeOrphan(
	snapshot: LedgerSnapshot,
	ref: string,
	audit: Record<string, string>,
	block: BananoBlock | undefined,
	hotWallet: string
): OrphanAttribution {
	const kind: TransferKind =
		audit.type === "deposit" ? "deposit" : "withdrawal";
	const send = sendOf(block);
	if (isFailure(send)) {
		return { outcome: send.reason, detail: send.detail };
	}
	const counterparty = counterpartyOf(kind, send);
	if (counterparty !== hotWallet) {
		return { outcome: hotWalletMismatch(kind), detail: counterparty };
	}
	const banAddress = accountOf(kind, send);
	if (send.amount !== audit.amount) {
		return {
			banAddress,
			outcome: "amount differs from the audit",
			detail: `chain ${send.amount}, audit ${audit.amount}`,
		};
	}
	const inHistory = (snapshot.history[kind].get(banAddress) ?? []).some(
		({ member }) => member.toUpperCase() === ref.toUpperCase()
	);
	return {
		banAddress,
		outcome: inHistory ? ATTRIBUTED_IN_HISTORY : ATTRIBUTED,
	};
}

export type ChainRecovery = {
	audits: AuditRecovery;
	orphans: Map<string, OrphanAttribution>;
};

export async function recoverFromChain(
	lookups: ChainLookups,
	snapshot: LedgerSnapshot
): Promise<ChainRecovery> {
	const hotWallet = lookups.hotWallet.toLowerCase();
	const missing = missingAudits(snapshot);
	const orphanTransfers = unreferencedAudits(snapshot).filter(([, audit]) =>
		["deposit", "withdrawal"].includes(audit.type)
	);
	const blocks = await blocksOf(lookups.node, [
		...new Set([
			...missing.filter((m) => isTransfer(m.kind)).map((m) => m.member),
			...orphanTransfers.map(([ref]) => ref),
		]),
	]);
	const audits: AuditRecovery = {
		recovered: new Map(),
		unrecovered: new Map(),
	};
	const settle = (
		item: MissingAudit,
		result: RecoveredAudit | RecoveryFailure
	) => {
		const key = recoveryKey(item.kind, item.member);
		if (isFailure(result)) {
			audits.unrecovered.set(key, result);
			return;
		}
		audits.recovered.set(key, result);
	};
	// eslint-disable-next-line no-restricted-syntax
	for (const item of missing) {
		switch (item.kind) {
			case "deposit":
			case "withdrawal":
				settle(
					item,
					recoverTransfer(
						item as MissingAudit & { kind: TransferKind },
						blocks.get(item.member),
						hotWallet
					)
				);
				break;
			case "swap_to_ban":
				// eslint-disable-next-line no-await-in-loop
				settle(item, await recoverUnwrap(lookups, item));
				break;
			case "swap_to_wban":
			default:
				settle(item, { reason: WRAP_NOT_RECOVERABLE });
		}
	}
	const orphans = new Map(
		orphanTransfers.map(([ref, audit]) => [
			ref,
			attributeOrphan(snapshot, ref, audit, blocks.get(ref), hotWallet),
		])
	);
	return { audits, orphans };
}

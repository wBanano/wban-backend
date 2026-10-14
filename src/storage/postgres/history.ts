import config from "../../ledgerConfig";
import { ledgerEntries } from "./schema";

type LedgerEntry = typeof ledgerEntries.$inferSelect;

export type HistoryRow = Pick<
	LedgerEntry,
	| "kind"
	| "banAddress"
	| "amount"
	| "ref"
	| "blockchainAddress"
	| "uuid"
	| "occurredAt"
	| "legacyAudit"
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HistoryItem = Record<string, any>;

export function bananoBlockLink(hash: string): string {
	return `https://creeper.banano.cc/explorer/block/${hash}`;
}

export function blockchainTxLink(hash: string): string {
	return `${config.BlockchainBlockExplorerUrl}/tx/${hash}`;
}

function withoutEmptyFields(item: HistoryItem): HistoryItem {
	return Object.fromEntries(
		Object.entries(item).filter(([, value]) => value !== null)
	);
}

function legacyHistoryItem(row: HistoryRow): HistoryItem | undefined {
	return row.legacyAudit ? { ...row.legacyAudit } : undefined;
}

export function depositHistoryItem(row: HistoryRow): HistoryItem {
	const ref = row.ref ?? "";
	const item = legacyHistoryItem(row) ?? {
		type: "deposit",
		hash: ref,
		amount: row.amount,
		timestamp: String(row.occurredAt.getTime()),
	};
	return { ...item, link: bananoBlockLink(ref) };
}

export function withdrawalHistoryItem(row: HistoryRow): HistoryItem {
	const ref = row.ref ?? "";
	const item = legacyHistoryItem(row) ?? {
		type: "withdrawal",
		hash: ref,
		amount: row.amount,
		timestamp: String(row.occurredAt.getTime()),
	};
	return { ...item, link: bananoBlockLink(ref) };
}

export function swapToWBanHistoryItem(row: HistoryRow): HistoryItem {
	return (
		legacyHistoryItem(row) ??
		withoutEmptyFields({
			type: "swap-to-wban",
			blockchainAddress: row.blockchainAddress,
			receipt: row.ref,
			uuid: row.uuid,
			amount: row.amount,
			timestamp: String(row.occurredAt.getTime()),
		})
	);
}

export function swapToBanHistoryItem(row: HistoryRow): HistoryItem {
	const item = legacyHistoryItem(row) ?? {
		type: "swap-to-ban",
		hash: row.ref,
		banAddress: row.banAddress,
		amount: row.amount,
		timestamp: String(row.occurredAt.getTime() * 1_000),
	};
	if (item.type !== "swap-to-ban") {
		return item;
	}
	return { ...item, link: blockchainTxLink(row.ref ?? "") };
}

export function historyItem(row: HistoryRow): HistoryItem {
	switch (row.kind) {
		case "deposit":
			return depositHistoryItem(row);
		case "withdrawal":
			return withdrawalHistoryItem(row);
		case "swap_to_wban":
			return swapToWBanHistoryItem(row);
		case "swap_to_ban":
		default:
			return swapToBanHistoryItem(row);
	}
}

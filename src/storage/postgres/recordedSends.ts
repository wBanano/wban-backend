import { and, eq, inArray } from "drizzle-orm";
import { Database } from "./database";
import { ledgerEntries, refunds } from "./schema";

export type OpenSend = { kind: "withdrawal" | "refund"; id: string };

export async function recordedSendHashes(
	db: Database,
	hashes: string[]
): Promise<Set<string>> {
	if (hashes.length === 0) {
		return new Set();
	}
	const [withdrawals, refundSends] = await Promise.all([
		db
			.select({ hash: ledgerEntries.ref })
			.from(ledgerEntries)
			.where(
				and(
					eq(ledgerEntries.kind, "withdrawal"),
					inArray(ledgerEntries.ref, hashes)
				)
			),
		db
			.select({ hash: refunds.sendHash })
			.from(refunds)
			.where(inArray(refunds.sendHash, hashes)),
	]);
	return new Set([...withdrawals, ...refundSends].map((row) => row.hash ?? ""));
}

export async function openSendsLike(
	db: Database,
	banAddress: string,
	amount: string
): Promise<OpenSend[]> {
	const [withdrawals, openRefunds] = await Promise.all([
		db
			.select({ id: ledgerEntries.id })
			.from(ledgerEntries)
			.where(
				and(
					eq(ledgerEntries.kind, "withdrawal"),
					eq(ledgerEntries.status, "reserved"),
					eq(ledgerEntries.banAddress, banAddress),
					eq(ledgerEntries.amount, amount)
				)
			),
		db
			.select({ id: refunds.depositHash })
			.from(refunds)
			.where(
				and(
					eq(refunds.status, "reserved"),
					eq(refunds.banAddress, banAddress),
					eq(refunds.amount, amount)
				)
			),
	]);
	return [
		...withdrawals.map(
			({ id }): OpenSend => ({
				kind: "withdrawal",
				id: String(id),
			})
		),
		...openRefunds.map(({ id }): OpenSend => ({ kind: "refund", id })),
	];
}

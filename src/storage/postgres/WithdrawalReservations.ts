import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { BigNumber } from "ethers";
import { Database } from "./database";
import { OpenSend, openSendsLike, recordedSendHashes } from "./recordedSends";
import { accounts, ledgerEntries } from "./schema";

export type ReservedWithdrawal = {
	id: number;
	banAddress: string;
	amount: string;
	requestTimestamp: number;
	reservedAt: Date;
};

export const STUCK_AFTER_MINUTES = 10;

const reservedColumns = {
	id: ledgerEntries.id,
	banAddress: ledgerEntries.banAddress,
	amount: ledgerEntries.amount,
	requestTimestamp: ledgerEntries.requestTimestamp,
	reservedAt: ledgerEntries.createdAt,
};

const isReserved = and(
	eq(ledgerEntries.kind, "withdrawal"),
	eq(ledgerEntries.status, "reserved")
);

export class WithdrawalReservations {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	async list(olderThanMinutes = 0): Promise<ReservedWithdrawal[]> {
		const rows = await this.db
			.select(reservedColumns)
			.from(ledgerEntries)
			.where(
				and(
					isReserved,
					sql`${ledgerEntries.createdAt} < now() - make_interval(mins => ${olderThanMinutes})`
				)
			)
			.orderBy(asc(ledgerEntries.createdAt));
		return rows as ReservedWithdrawal[];
	}

	async get(id: number): Promise<ReservedWithdrawal | undefined> {
		const [row] = await this.db
			.select(reservedColumns)
			.from(ledgerEntries)
			.where(and(isReserved, eq(ledgerEntries.id, id)));
		return row as ReservedWithdrawal | undefined;
	}

	async recordedSendHashes(hashes: string[]): Promise<Set<string>> {
		return recordedSendHashes(this.db, hashes);
	}

	async otherOpenSends(reservation: ReservedWithdrawal): Promise<OpenSend[]> {
		return (
			await openSendsLike(this.db, reservation.banAddress, reservation.amount)
		).filter(
			(open) => open.kind !== "withdrawal" || open.id !== String(reservation.id)
		);
	}

	async confirm(id: number, hash: string): Promise<void> {
		const confirmed = await this.db
			.update(ledgerEntries)
			.set({ status: "sent", ref: hash, updatedAt: sql`now()` })
			.where(and(isReserved, eq(ledgerEntries.id, id)))
			.returning({ id: ledgerEntries.id });
		if (confirmed.length === 0) {
			throw new Error(`Withdrawal ${id} is not reserved`);
		}
	}

	async release(id: number): Promise<void> {
		await this.db.transaction(async (tx) => {
			const [reservation] = await tx
				.select({
					banAddress: ledgerEntries.banAddress,
					amount: ledgerEntries.amount,
				})
				.from(ledgerEntries)
				.where(and(isReserved, eq(ledgerEntries.id, id)))
				.for("update");
			if (!reservation) {
				throw new Error(`Withdrawal ${id} is not reserved`);
			}
			const [account] = await tx
				.select({ balance: accounts.balance })
				.from(accounts)
				.where(eq(accounts.banAddress, reservation.banAddress))
				.for("update");
			await tx
				.update(ledgerEntries)
				.set({ status: "released", updatedAt: sql`now()` })
				.where(eq(ledgerEntries.id, id));
			await tx
				.update(accounts)
				.set({
					balance: BigNumber.from(account.balance)
						.add(reservation.amount)
						.toString(),
					updatedAt: sql`now()`,
				})
				.where(eq(accounts.banAddress, reservation.banAddress));
		});
	}
}

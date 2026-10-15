import { and, asc, eq, sql } from "drizzle-orm";
import { Database } from "./database";
import { refunds } from "./schema";
import { OpenSend, openSendsLike, recordedSendHashes } from "./recordedSends";

export type ReservedRefund = {
	depositHash: string;
	banAddress: string;
	amount: string;
	reservedAt: Date;
};

const reservedColumns = {
	depositHash: refunds.depositHash,
	banAddress: refunds.banAddress,
	amount: refunds.amount,
	reservedAt: refunds.createdAt,
};

const isReserved = eq(refunds.status, "reserved");

export class RefundReservations {
	private db: Database;

	constructor(db: Database) {
		this.db = db;
	}

	async list(olderThanMinutes = 0): Promise<ReservedRefund[]> {
		return this.db
			.select(reservedColumns)
			.from(refunds)
			.where(
				and(
					isReserved,
					sql`${refunds.createdAt} < now() - make_interval(mins => ${olderThanMinutes})`
				)
			)
			.orderBy(asc(refunds.createdAt));
	}

	async get(depositHash: string): Promise<ReservedRefund | undefined> {
		const [row] = await this.db
			.select(reservedColumns)
			.from(refunds)
			.where(and(isReserved, eq(refunds.depositHash, depositHash)));
		return row;
	}

	async recordedSendHashes(hashes: string[]): Promise<Set<string>> {
		return recordedSendHashes(this.db, hashes);
	}

	async otherOpenSends(reservation: ReservedRefund): Promise<OpenSend[]> {
		return (
			await openSendsLike(this.db, reservation.banAddress, reservation.amount)
		).filter(
			(open) => open.kind !== "refund" || open.id !== reservation.depositHash
		);
	}

	async confirm(depositHash: string, sendHash: string): Promise<void> {
		const confirmed = await this.db
			.update(refunds)
			.set({ status: "sent", sendHash, updatedAt: sql`now()` })
			.where(and(isReserved, eq(refunds.depositHash, depositHash)))
			.returning({ depositHash: refunds.depositHash });
		if (confirmed.length === 0) {
			throw new Error(`The refund of deposit ${depositHash} is not reserved`);
		}
	}
}

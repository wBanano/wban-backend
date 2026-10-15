import { sql } from "drizzle-orm";
import { Database } from "./database";
import { RefundReservations, ReservedRefund } from "./RefundReservations";
import {
	ReservedWithdrawal,
	STUCK_AFTER_MINUTES,
	WithdrawalReservations,
} from "./WithdrawalReservations";

export const BALANCE_MISMATCH = "balance_mismatch";

export type BalanceMismatch = {
	banAddress: string;
	balance: string;
	expected: string;
};

export type LedgerHealthReport = {
	stuckWithdrawals: ReservedWithdrawal[];
	stuckRefunds: ReservedRefund[];
	balanceMismatches: BalanceMismatch[];
};

export class LedgerHealth {
	private db: Database;

	private reservations: WithdrawalReservations;

	private refunds: RefundReservations;

	constructor(db: Database) {
		this.db = db;
		this.reservations = new WithdrawalReservations(db);
		this.refunds = new RefundReservations(db);
	}

	async stuckWithdrawals(): Promise<ReservedWithdrawal[]> {
		return this.reservations.list(STUCK_AFTER_MINUTES);
	}

	async stuckRefunds(): Promise<ReservedRefund[]> {
		return this.refunds.list(STUCK_AFTER_MINUTES);
	}

	async balanceMismatches(): Promise<BalanceMismatch[]> {
		const { rows } = await this.db.execute<BalanceMismatch>(sql`
			with entries as (
				select ban_address, sum(
					case
						when kind in ('deposit', 'swap_to_ban') then amount
						when status = 'released' then 0
						else -amount
					end
				) as net
				from ledger_entries
				group by ban_address
			), adjustments as (
				select ban_address, sum(stored_balance - recomputed_balance) as delta
				from migration_discrepancies
				where kind = ${BALANCE_MISMATCH}
				group by ban_address
			)
			select a.ban_address as "banAddress", a.balance::text as balance,
				(coalesce(e.net, 0) + coalesce(d.delta, 0))::text as expected
			from accounts a
			left join entries e using (ban_address)
			left join adjustments d using (ban_address)
			where a.balance <> coalesce(e.net, 0) + coalesce(d.delta, 0)
			order by a.ban_address
		`);
		return rows;
	}

	async report(): Promise<LedgerHealthReport> {
		return {
			stuckWithdrawals: await this.stuckWithdrawals(),
			stuckRefunds: await this.stuckRefunds(),
			balanceMismatches: await this.balanceMismatches(),
		};
	}
}

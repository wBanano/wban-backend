import { sql } from "drizzle-orm";
import { Database } from "../../storage/postgres/database";
import {
	accounts,
	claims,
	gaslessSwaps,
	ledgerEntries,
	migrationDiscrepancies,
	scanState,
} from "../../storage/postgres/schema";
import { MigrationPlan } from "./plan";

const TARGET_TABLES = {
	accounts,
	ledger_entries: ledgerEntries,
	claims,
	gasless_swaps: gaslessSwaps,
	scan_state: scanState,
	migration_discrepancies: migrationDiscrepancies,
};

const CHUNK = 500;

function chunks<T>(rows: T[]): T[][] {
	const result: T[][] = [];
	for (let start = 0; start < rows.length; start += CHUNK) {
		result.push(rows.slice(start, start + CHUNK));
	}
	return result;
}

export async function countTargetRows(
	db: Database
): Promise<Record<string, number>> {
	const counts: Record<string, number> = {};
	await Promise.all(
		Object.entries(TARGET_TABLES).map(async ([name, table]) => {
			const [row] = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(table);
			counts[name] = row.count;
		})
	);
	return counts;
}

export async function assertTargetIsEmpty(db: Database): Promise<void> {
	const filled = Object.entries(await countTargetRows(db)).filter(
		([, count]) => count > 0
	);
	if (filled.length > 0) {
		throw new Error(
			`Refusing to write, the target already has rows: ${filled
				.map(([name, count]) => `${name}=${count}`)
				.join(", ")}`
		);
	}
}

export function assertWritable(plan: MigrationPlan): void {
	if (plan.blocking.length > 0) {
		throw new Error(
			`Refusing to write, ${plan.blocking.length} blocking issues in the report`
		);
	}
}

export async function writePlan(
	db: Database,
	plan: MigrationPlan
): Promise<void> {
	assertWritable(plan);
	await assertTargetIsEmpty(db);
	await db.transaction(async (tx) => {
		// eslint-disable-next-line no-restricted-syntax
		for (const rows of chunks(plan.accounts)) {
			// eslint-disable-next-line no-await-in-loop
			await tx.insert(accounts).values(rows);
		}
		// eslint-disable-next-line no-restricted-syntax
		for (const rows of chunks(plan.entries)) {
			// eslint-disable-next-line no-await-in-loop
			await tx.insert(ledgerEntries).values(rows);
		}
		// eslint-disable-next-line no-restricted-syntax
		for (const rows of chunks(plan.claims)) {
			// eslint-disable-next-line no-await-in-loop
			await tx.insert(claims).values(
				rows.map((claim) => ({
					...claim,
					expiresAt:
						claim.status === "pending"
							? sql`now() + interval '5 minutes'`
							: null,
				}))
			);
		}
		// eslint-disable-next-line no-restricted-syntax
		for (const rows of chunks(plan.gasless)) {
			// eslint-disable-next-line no-await-in-loop
			await tx.insert(gaslessSwaps).values(rows);
		}
		if (plan.lastBlockProcessed !== undefined) {
			await tx
				.insert(scanState)
				.values({ lastBlockProcessed: plan.lastBlockProcessed });
		}
		// eslint-disable-next-line no-restricted-syntax
		for (const rows of chunks(plan.discrepancies)) {
			// eslint-disable-next-line no-await-in-loop
			await tx.insert(migrationDiscrepancies).values(rows);
		}
	});
}

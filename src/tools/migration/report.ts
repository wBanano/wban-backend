import { BigNumber, ethers } from "ethers";
import { LedgerSnapshot } from "./snapshot";
import {
	BalanceComparison,
	BlockingIssue,
	Discrepancy,
	MigrationPlan,
} from "./plan";

export type TargetState = {
	schema: string;
	chain: string;
	rows: Record<string, number>;
};

const BAN = (raw: string | BigNumber) => `${ethers.utils.formatEther(raw)} BAN`;

function listed<T>(
	items: T[],
	line: (item: T) => string,
	limit: number
): string[] {
	const shown = items.slice(0, limit).map((item) => `  ${line(item)}`);
	if (items.length > limit) {
		shown.push(`  ... and ${items.length - limit} more`);
	}
	return shown;
}

function section(title: string, lines: string[]): string[] {
	return ["", `== ${title}`, ...(lines.length > 0 ? lines : ["  none"])];
}

function countsBy<T>(items: T[], key: (item: T) => string): [string, number][] {
	const counts = new Map<string, number>();
	items.forEach((item) =>
		counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
	);
	return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function oddityGroup(discrepancy: Discrepancy): string {
	const { type } = discrepancy.details as { type: string };
	return `${discrepancy.redisKey?.split(":")[0]} ${type}`;
}

function historyType(issue: BlockingIssue): string {
	return issue.key.split(":").slice(0, -1).join(":");
}

function auditType(discrepancy: Discrepancy): string {
	return String((discrepancy.details as { type?: string }).type);
}

function countLines<T>(items: T[], key: (item: T) => string): string[] {
	return countsBy(items, key).map(([group, count]) => `  ${group}: ${count}`);
}

function discrepanciesOf(plan: MigrationPlan, kind: string): Discrepancy[] {
	return plan.discrepancies.filter((discrepancy) => discrepancy.kind === kind);
}

type UnrecoveredDetails = {
	kind: string;
	ref: string;
	reason: string;
	detail?: string;
};

type AttributionDetails = {
	type: string;
	attribution?: { outcome: string; detail?: string };
};

function recoveryLines(plan: MigrationPlan, limit: number): string[] {
	const unrecovered = discrepanciesOf(plan, "unrecovered_audit");
	const detailsOf = (d: Discrepancy) => d.details as UnrecoveredDetails;
	return [
		...countLines(
			plan.entries.filter((entry) => entry.recoveredFrom),
			(entry) => `recovered ${entry.kind} from ${entry.recoveredFrom}`
		),
		...countLines(
			unrecovered,
			(d) => `not recovered ${detailsOf(d).kind}: ${detailsOf(d).reason}`
		),
		...listed(
			unrecovered,
			(d) =>
				`${d.redisKey} ${detailsOf(d).ref}: ${detailsOf(d).reason}${
					detailsOf(d).detail ? ` (${detailsOf(d).detail})` : ""
				}`,
			limit
		),
	];
}

function attributionLines(plan: MigrationPlan, limit: number): string[] {
	const attributed = discrepanciesOf(plan, "orphan_audit").filter(
		(d) => (d.details as AttributionDetails).attribution
	);
	const outcomeOf = (d: Discrepancy) => {
		const { type, attribution } = d.details as AttributionDetails;
		return `${type}: ${attribution?.outcome}`;
	};
	return [
		...countLines(attributed, outcomeOf),
		...listed(
			attributed,
			(d) => {
				const detail = (d.details as AttributionDetails).attribution?.detail;
				return `${d.redisKey} ${d.banAddress ?? "no account"} ${outcomeOf(d)}${
					detail ? ` (${detail})` : ""
				}`;
			},
			limit
		),
	];
}

function balanceLine(b: BalanceComparison): string {
	return `${b.banAddress} stored ${BAN(b.stored)}${
		b.hasBalanceKey ? "" : " (no ban-balance key)"
	}, recomputed ${BAN(b.recomputed)}, difference ${BAN(
		BigNumber.from(b.stored).sub(b.recomputed)
	)}`;
}

function driftLines(plan: MigrationPlan, limit: number): string[] {
	const drift = plan.balances.filter(
		(b) => b.historyComplete && b.stored !== b.recomputed
	);
	const incomplete = plan.balances.filter((b) => !b.historyComplete).length;
	const net = drift.reduce(
		(sum, b) => sum.add(b.stored).sub(b.recomputed),
		BigNumber.from(0)
	);
	return [
		`  ${drift.length} accounts, stored minus recomputed ${BAN(net)} in total`,
		`  left out: ${incomplete} accounts with incomplete history, ${plan.stats.unrecoveredWithoutAccount} unrecovered unwraps and ${plan.stats.orphansWithoutAccount} unreferenced audits that name no account`,
		...listed(drift, balanceLine, limit),
	];
}

function balanceLines(plan: MigrationPlan, limit: number): string[] {
	const mismatches = plan.balances.filter((b) => b.stored !== b.recomputed);
	const total = (pick: (b: BalanceComparison) => string) =>
		plan.balances.reduce((sum, b) => sum.add(pick(b)), BigNumber.from(0));
	return [
		`  ${plan.balances.length - mismatches.length} of ${
			plan.balances.length
		} accounts match their history`,
		`  sum stored ${BAN(total((b) => b.stored))}, sum recomputed ${BAN(
			total((b) => b.recomputed)
		)}`,
		...listed(mismatches, balanceLine, limit),
	];
}

const LARGEST_ACCOUNTS = 7;
const RANDOM_ACCOUNTS = 3;

export function accountsForIndependentCheck(plan: MigrationPlan): string[] {
	const byBalance = [...plan.accounts].sort((a, b) =>
		BigNumber.from(b.balance).gt(a.balance) ? 1 : -1
	);
	const largest = byBalance.slice(0, LARGEST_ACCOUNTS);
	const random = byBalance
		.slice(LARGEST_ACCOUNTS)
		.map((account) => ({ account, order: Math.random() }))
		.sort((a, b) => a.order - b.order)
		.slice(0, RANDOM_ACCOUNTS)
		.map(({ account }) => account);
	return [...largest, ...random].map(
		(account) =>
			`${account.banAddress} stored ${ethers.utils.formatEther(
				account.balance
			)}`
	);
}

export function formatReport(
	snapshot: LedgerSnapshot,
	plan: MigrationPlan,
	target: TargetState | undefined,
	limit = 50
): string {
	const { stats } = plan;
	const missingAudits = plan.blocking.filter(
		(issue) => issue.kind === "missing_audit"
	);
	const orphanAudits = discrepanciesOf(plan, "orphan_audit");
	const lines = [
		"Redis to Postgres ledger migration report",
		...section(
			"Redis keys by type",
			Object.entries(snapshot.keyCounts).map(
				([type, count]) => `  ${type}: ${count}`
			)
		),
		...section("Rows planned per table", [
			`  accounts: ${plan.accounts.length}`,
			...countsBy(plan.entries, (entry) => entry.kind).map(
				([kind, count]) => `  ledger_entries ${kind}: ${count}`
			),
			...countsBy(plan.claims, (claim) => claim.status).map(
				([status, count]) => `  claims ${status}: ${count}`
			),
			`  gasless_swaps: ${plan.gasless.length}`,
			`  scan_state: ${
				plan.lastBlockProcessed === undefined
					? "none (config start block applies)"
					: plan.lastBlockProcessed
			}`,
			...countsBy(plan.discrepancies, (d) => d.kind).map(
				([kind, count]) => `  migration_discrepancies ${kind}: ${count}`
			),
		]),
		...section(
			"Balances, stored vs recomputed from history",
			balanceLines(plan, limit)
		),
		...section(
			"Real drift: complete history, stored balance differs",
			driftLines(plan, limit)
		),
		...section(
			`Accounts for the independent check (${LARGEST_ACCOUNTS} largest, ${RANDOM_ACCOUNTS} random)`,
			accountsForIndependentCheck(plan).map((line) => `  ${line}`)
		),
		...section(
			"Negative stored balances",
			listed(
				discrepanciesOf(plan, "negative_balance"),
				(d) => `${d.banAddress} ${BAN(d.storedBalance ?? "0")}`,
				limit
			)
		),
		...section("History entries without an audit hash", [
			...countLines(missingAudits, historyType),
			...listed(
				missingAudits,
				(issue) => `${issue.key}: ${issue.detail}`,
				limit
			),
		]),
		...section("History recovered from the chain", recoveryLines(plan, limit)),
		...section(
			"Unreferenced deposit and withdrawal audits, attributed through the node",
			attributionLines(plan, limit)
		),
		...section("Audit hashes nobody references", [
			...countLines(orphanAudits, auditType),
			...listed(
				orphanAudits,
				(d) => `${d.redisKey} ${JSON.stringify(d.details)}`,
				limit
			),
		]),
		...section(
			"Duplicate refs",
			listed(
				plan.blocking.filter((issue) =>
					["duplicate_ref", "duplicate_withdrawal_request"].includes(issue.kind)
				),
				(issue) => `${issue.kind} ${issue.key}: ${issue.detail}`,
				limit
			)
		),
		...section("Timestamp unit oddities", [
			...countsBy(discrepanciesOf(plan, "timestamp_oddity"), oddityGroup).map(
				([group, count]) => `  ${group}: ${count}`
			),
			...listed(
				discrepanciesOf(plan, "timestamp_oddity"),
				(d) => {
					const { ref, oddity } = d.details as { ref: string; oddity: string };
					return `${d.redisKey} ${ref}: ${oddity}`;
				},
				limit
			),
		]),
		...section("Zero amounts", [`  ${stats.zeroAmounts} rows`]),
		...section("Rows that need legacy_audit", [
			`  ${Object.values(stats.legacyRows).reduce((a, b) => a + b, 0)} rows`,
			...Object.entries(stats.legacyRows).map(
				([fields, count]) => `  differing fields ${fields}: ${count}`
			),
		]),
		...section("Unwraps without banAddress", [
			`  ${stats.unwrapsMissingBanAddress} missing, ${stats.unwrapsRecovered} recovered from the chain`,
		]),
		...section("Claims", [
			`  confirmed ${snapshot.confirmedClaims.length}, pending ${snapshot.pendingClaims.length} (${stats.pendingClaimsMigrated} migrated, expiring 5 minutes after the write)`,
			`  BAN addresses with more than one confirmed claim: ${stats.banAddressesWithSeveralClaims}`,
			`  EVM addresses with more than one confirmed claim: ${stats.blockchainAddressesWithSeveralClaims}`,
		]),
		...section(
			"Keys the tool can't parse",
			listed(
				[
					...snapshot.unparsed.map(({ key, reason }) => `${key}: ${reason}`),
					...snapshot.unknownKeys.map((key) => `${key}: unknown key type`),
				],
				(line) => line,
				limit
			)
		),
		...section(
			"Target database",
			target
				? [
						`  schema: ${target.schema}`,
						`  chain_meta: ${target.chain}`,
						`  rows: ${Object.entries(target.rows)
							.map(([table, count]) => `${table}=${count}`)
							.join(", ")}`,
				  ]
				: ["  not configured (DATABASE_HOST unset), only Redis was read"]
		),
		...section(
			`Blocking issues (--write refuses while there are any): ${plan.blocking.length}`,
			[
				...countsBy(plan.blocking, (issue) => issue.kind).map(
					([kind, count]) => `  ${kind}: ${count}`
				),
				...listed(
					plan.blocking,
					(issue) => `${issue.kind} ${issue.key}: ${issue.detail}`,
					limit
				),
			]
		),
	];
	return lines.join("\n");
}

import { isDeepStrictEqual } from "util";
import { BigNumber } from "ethers";
import {
	claims,
	ledgerEntries,
	migrationDiscrepancies,
} from "../../storage/postgres/schema";
import {
	HistoryItem,
	HistoryRow,
	bananoBlockLink,
	blockchainTxLink,
	historyItem,
} from "../../storage/postgres/history";
import { BALANCE_MISMATCH } from "../../storage/postgres/LedgerHealth";
import { Claim, HistoryKind, LedgerSnapshot, ScoredMember } from "./snapshot";

export type PlannedEntry = typeof ledgerEntries.$inferInsert & {
	banAddress: string;
	kind: HistoryKind;
	amount: string;
	ref: string;
	occurredAt: Date;
};

export type PlannedClaim = Omit<typeof claims.$inferInsert, "expiresAt">;

export type Discrepancy = typeof migrationDiscrepancies.$inferInsert & {
	kind: string;
};

export type BlockingIssue = { kind: string; key: string; detail: string };

export type BalanceComparison = {
	banAddress: string;
	stored: string;
	recomputed: string;
	hasBalanceKey: boolean;
};

export type MigrationPlan = {
	accounts: { banAddress: string; balance: string }[];
	entries: PlannedEntry[];
	claims: PlannedClaim[];
	gasless: { banAddress: string; txnId: string }[];
	lastBlockProcessed: number | undefined;
	balances: BalanceComparison[];
	discrepancies: Discrepancy[];
	blocking: BlockingIssue[];
	stats: {
		zeroAmounts: number;
		legacyRows: Record<string, number>;
		unwrapsMissingBanAddress: number;
		unwrapsRecovered: number;
		banAddressesWithSeveralClaims: number;
		blockchainAddressesWithSeveralClaims: number;
		pendingClaimsMigrated: number;
	};
};

export type PlanOptions = {
	recoveredBanAddresses?: Map<string, string>;
	skipUnknownKeys?: boolean;
};

const ZSET_PREFIX: Record<HistoryKind, string> = {
	deposit: "deposits:",
	withdrawal: "withdrawals:",
	swap_to_wban: "swaps:ban-to-wban:",
	swap_to_ban: "swaps:wban-to-ban:",
};

const MS_RANGE = { from: 1.4e12, to: 4.1e12 };

const isMilliseconds = (value: number) =>
	value >= MS_RANGE.from && value <= MS_RANGE.to;

const isMicroseconds = (value: number) =>
	value >= MS_RANGE.from * 1_000 && value <= MS_RANGE.to * 1_000;

const CREDITS: HistoryKind[] = ["deposit", "swap_to_ban"];

function redisHistoryItem(
	kind: HistoryKind,
	member: string,
	audit: Record<string, string>
): HistoryItem {
	switch (kind) {
		case "deposit":
		case "withdrawal":
			return { ...audit, link: bananoBlockLink(member) };
		case "swap_to_wban":
		case "swap_to_ban":
		default:
			return audit.type === "swap-to-ban"
				? { ...audit, link: blockchainTxLink(member) }
				: { ...audit };
	}
}

function occurredAt(kind: HistoryKind, score: number): Date {
	if (kind === "swap_to_ban" && !isMilliseconds(score)) {
		return new Date(score / 1_000);
	}
	return new Date(score);
}

function blockchainAddressOf(
	kind: HistoryKind,
	owner: string,
	audit: Record<string, string>
): string | null {
	switch (kind) {
		case "swap_to_ban":
			return owner;
		case "swap_to_wban":
			return audit.blockchainAddress?.toLowerCase() ?? null;
		default:
			return null;
	}
}

type TimestampOddity = { type: string; oddity: string };

function timestampOddity(
	kind: HistoryKind,
	score: number,
	audit: Record<string, string>
): TimestampOddity | undefined {
	if (audit.timestamp !== String(score)) {
		return {
			type: "audit timestamp differs from score",
			oddity: `audit timestamp ${audit.timestamp}, score ${score}`,
		};
	}
	if (kind === "swap_to_ban" && isMilliseconds(score)) {
		return {
			type: "unwrap score in milliseconds",
			oddity: `score ${score}`,
		};
	}
	if (kind === "swap_to_ban" && !isMicroseconds(score)) {
		return {
			type: "unwrap score in an unknown unit",
			oddity: `score ${score}`,
		};
	}
	if (kind !== "swap_to_ban" && !isMilliseconds(score)) {
		return { type: "score not in milliseconds", oddity: `score ${score}` };
	}
	return undefined;
}

class Planner {
	private snapshot: LedgerSnapshot;

	private options: PlanOptions;

	private plan: MigrationPlan;

	private referencedAudits = new Set<string>();

	constructor(snapshot: LedgerSnapshot, options: PlanOptions) {
		this.snapshot = snapshot;
		this.options = options;
		this.plan = {
			accounts: [],
			entries: [],
			claims: [],
			gasless: [],
			lastBlockProcessed: undefined,
			balances: [],
			discrepancies: [],
			blocking: [],
			stats: {
				zeroAmounts: 0,
				legacyRows: {},
				unwrapsMissingBanAddress: 0,
				unwrapsRecovered: 0,
				banAddressesWithSeveralClaims: 0,
				blockchainAddressesWithSeveralClaims: 0,
				pendingClaimsMigrated: 0,
			},
		};
	}

	build(): MigrationPlan {
		this.blockOnUnreadableKeys();
		(Object.keys(ZSET_PREFIX) as HistoryKind[]).forEach((kind) =>
			this.snapshot.history[kind].forEach((members, owner) =>
				members.forEach((member) => this.planEntry(kind, owner, member))
			)
		);
		this.blockOnDuplicates();
		this.recordOrphanAudits();
		this.planAccounts();
		this.planClaims();
		this.planGaslessAndScanState();
		return this.plan;
	}

	private block(kind: string, key: string, detail: string): void {
		this.plan.blocking.push({ kind, key, detail });
	}

	private record(discrepancy: Discrepancy): void {
		this.plan.discrepancies.push(discrepancy);
	}

	private blockOnUnreadableKeys(): void {
		this.snapshot.unparsed.forEach(({ key, reason }) =>
			this.block("unparsed_key", key, reason)
		);
		if (this.snapshot.marker !== undefined) {
			this.block(
				"ledger_marker",
				"ledger:backend",
				`already set to ${this.snapshot.marker}`
			);
		}
		this.snapshot.unknownKeys.forEach((key) => {
			if (!this.options.skipUnknownKeys) {
				this.block("unknown_key", key, "not a ledger, BullMQ or lock key");
				return;
			}
			this.record({ kind: "unknown_key", redisKey: key });
		});
	}

	private banAddressOf(
		kind: HistoryKind,
		owner: string,
		member: string,
		audit: Record<string, string>
	): string | undefined {
		if (kind !== "swap_to_ban") {
			return owner;
		}
		if (audit.banAddress) {
			return audit.banAddress.toLowerCase();
		}
		this.plan.stats.unwrapsMissingBanAddress += 1;
		const recovered = this.options.recoveredBanAddresses?.get(member);
		if (!recovered) {
			return undefined;
		}
		this.plan.stats.unwrapsRecovered += 1;
		this.record({
			kind: "recovered_ban_address",
			banAddress: recovered,
			redisKey: `audit:${member}`,
			details: { source: "SwapToBan event of the transaction" },
		});
		return recovered;
	}

	private planEntry(kind: HistoryKind, owner: string, scored: ScoredMember) {
		const { member, score } = scored;
		const key = `${ZSET_PREFIX[kind]}${owner}`;
		this.referencedAudits.add(member);
		const audit = this.snapshot.audits.get(member);
		if (!audit || Object.keys(audit).length === 0) {
			this.block("missing_audit", key, `${member} has no audit hash`);
			return;
		}
		if (!/^\d+$/.test(audit.amount ?? "")) {
			this.block("invalid_amount", key, `${member} has amount ${audit.amount}`);
			return;
		}
		const banAddress = this.banAddressOf(kind, owner, member, audit);
		if (!banAddress) {
			this.block(
				"unwrap_without_ban_address",
				key,
				`${member} has no banAddress and none was recovered from the chain`
			);
			return;
		}
		if (audit.amount === "0") {
			this.plan.stats.zeroAmounts += 1;
			this.block(
				"zero_amount",
				key,
				`${member} has amount 0, the amount check has to allow 0 first`
			);
		}
		const oddity = timestampOddity(kind, score, audit);
		if (oddity) {
			this.record({
				kind: "timestamp_oddity",
				banAddress,
				redisKey: key,
				details: { ref: member, ...oddity },
			});
		}
		const entry: PlannedEntry = {
			banAddress,
			kind,
			amount: audit.amount,
			ref: member,
			blockchainAddress: blockchainAddressOf(kind, owner, audit),
			uuid: kind === "swap_to_wban" ? audit.uuid ?? null : null,
			status: kind === "withdrawal" ? "sent" : null,
			requestTimestamp: kind === "withdrawal" ? score : null,
			occurredAt: occurredAt(kind, score),
		};
		this.keepRedisRendering(entry, audit);
		this.plan.entries.push(entry);
	}

	private keepRedisRendering(
		entry: PlannedEntry,
		audit: Record<string, string>
	): void {
		const redisItem = redisHistoryItem(entry.kind, entry.ref, audit);
		const row: HistoryRow = {
			kind: entry.kind,
			banAddress: entry.banAddress,
			amount: entry.amount,
			ref: entry.ref,
			blockchainAddress: entry.blockchainAddress ?? null,
			uuid: entry.uuid ?? null,
			occurredAt: entry.occurredAt,
			legacyAudit: null,
		};
		const canonical = historyItem(row);
		if (isDeepStrictEqual(canonical, redisItem)) {
			return;
		}
		Object.assign(entry, { legacyAudit: audit });
		const fields = [
			...new Set([...Object.keys(canonical), ...Object.keys(redisItem)]),
		]
			.filter((field) => canonical[field] !== redisItem[field])
			.sort();
		const reason = fields.join(",");
		this.plan.stats.legacyRows[reason] =
			(this.plan.stats.legacyRows[reason] ?? 0) + 1;
		this.record({
			kind: "legacy_render",
			banAddress: entry.banAddress,
			redisKey: `audit:${entry.ref}`,
			details: { kind: entry.kind, fields },
		});
	}

	private blockOnDuplicates(): void {
		const seen = new Map<string, PlannedEntry>();
		const requests = new Map<string, PlannedEntry>();
		this.plan.entries.forEach((entry) => {
			const ref = `${entry.kind}:${entry.ref}`;
			const first = seen.get(ref);
			if (first) {
				this.block(
					"duplicate_ref",
					`audit:${entry.ref}`,
					`${entry.kind} ${entry.ref} is listed for ${first.banAddress} and ${entry.banAddress}`
				);
			}
			seen.set(ref, entry);
			if (entry.kind !== "withdrawal") {
				return;
			}
			const request = `${entry.banAddress}:${entry.requestTimestamp}`;
			const earlier = requests.get(request);
			if (earlier) {
				this.block(
					"duplicate_withdrawal_request",
					`withdrawals:${entry.banAddress}`,
					`${earlier.ref} and ${entry.ref} share request time ${entry.requestTimestamp}`
				);
			}
			requests.set(request, entry);
		});
	}

	private recordOrphanAudits(): void {
		this.snapshot.audits.forEach((audit, ref) => {
			if (this.referencedAudits.has(ref)) {
				return;
			}
			this.record({
				kind: "orphan_audit",
				redisKey: `audit:${ref}`,
				details: audit,
			});
		});
	}

	private planAccounts(): void {
		const recomputed = new Map<string, BigNumber>();
		this.plan.entries.forEach((entry) => {
			const current = recomputed.get(entry.banAddress) ?? BigNumber.from(0);
			recomputed.set(
				entry.banAddress,
				CREDITS.includes(entry.kind)
					? current.add(entry.amount)
					: current.sub(entry.amount)
			);
		});
		const addresses = [
			...new Set([...this.snapshot.balances.keys(), ...recomputed.keys()]),
		].sort();
		addresses.forEach((banAddress) => {
			const stored = this.snapshot.balances.get(banAddress) ?? "0";
			const history = (
				recomputed.get(banAddress) ?? BigNumber.from(0)
			).toString();
			this.plan.accounts.push({ banAddress, balance: stored });
			this.plan.balances.push({
				banAddress,
				stored,
				recomputed: history,
				hasBalanceKey: this.snapshot.balances.has(banAddress),
			});
			if (BigNumber.from(stored).isNegative()) {
				this.record({
					kind: "negative_balance",
					banAddress,
					storedBalance: stored,
				});
			}
			if (stored !== history) {
				this.record({
					kind: BALANCE_MISMATCH,
					banAddress,
					storedBalance: stored,
					recomputedBalance: history,
					details: { hasBalanceKey: this.snapshot.balances.has(banAddress) },
				});
			}
		});
	}

	private planClaims(): void {
		const { confirmedClaims, pendingClaims } = this.snapshot;
		const confirmedBans = new Set(confirmedClaims.map((c) => c.banAddress));
		const countBy = (list: Claim[], field: keyof Claim) =>
			list.reduce(
				(counts, claim) =>
					counts.set(claim[field], (counts.get(claim[field]) ?? 0) + 1),
				new Map<string, number>()
			);
		const several = (counts: Map<string, number>) =>
			[...counts.values()].filter((count) => count > 1).length;
		this.plan.stats.banAddressesWithSeveralClaims = several(
			countBy(confirmedClaims, "banAddress")
		);
		this.plan.stats.blockchainAddressesWithSeveralClaims = several(
			countBy(confirmedClaims, "blockchainAddress")
		);
		confirmedClaims.forEach((claim) =>
			this.plan.claims.push({
				...claim,
				status: "confirmed",
				confirmedAt: null,
			})
		);
		const pendingPerBan = countBy(pendingClaims, "banAddress");
		pendingClaims.forEach((claim) => {
			const key = `claims:pending:${claim.banAddress}:${claim.blockchainAddress}`;
			if (confirmedBans.has(claim.banAddress)) {
				this.record({
					kind: "pending_claim_superseded",
					banAddress: claim.banAddress,
					redisKey: key,
				});
				return;
			}
			if ((pendingPerBan.get(claim.banAddress) ?? 0) > 1) {
				this.record({
					kind: "pending_claims_conflict",
					banAddress: claim.banAddress,
					redisKey: key,
				});
				return;
			}
			this.plan.stats.pendingClaimsMigrated += 1;
			this.plan.claims.push({ ...claim, status: "pending" });
		});
	}

	private planGaslessAndScanState(): void {
		this.snapshot.gasless.forEach((txnId, banAddress) =>
			this.plan.gasless.push({ banAddress, txnId })
		);
		const { lastBlockProcessed } = this.snapshot;
		if (lastBlockProcessed === undefined) {
			return;
		}
		if (!/^\d+$/.test(lastBlockProcessed)) {
			this.block(
				"invalid_scan_state",
				"blockchain:blocks:latest",
				`${lastBlockProcessed} is not a block number`
			);
			return;
		}
		this.plan.lastBlockProcessed = Number(lastBlockProcessed);
	}
}

export function planMigration(
	snapshot: LedgerSnapshot,
	options: PlanOptions = {}
): MigrationPlan {
	return new Planner(snapshot, options).build();
}

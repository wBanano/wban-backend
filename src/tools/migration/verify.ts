import { isDeepStrictEqual } from "util";
import { Redis } from "ioredis";
import { BigNumber, ethers } from "ethers";
import { sql } from "drizzle-orm";
import { Database } from "../../storage/postgres/database";
import { accounts } from "../../storage/postgres/schema";
import { RedisUsersDepositsStorage } from "../../storage/RedisUsersDepositsStorage";
import { PostgresUsersDepositsStorage } from "../../storage/PostgresUsersDepositsStorage";
import { UsersDepositsStorage } from "../../storage/UsersDepositsStorage";
import { LedgerMarker } from "../../storage/LedgerMarker";
import { HistoryItem, historyItem } from "../../storage/postgres/history";
import { MigrationPlan, PlannedEntry, historyRowOf } from "./plan";
import { HistoryKind } from "./snapshot";
import { recoveryKey } from "./recoverAudits";
import { countTargetRows } from "./write";

export type Difference = {
	check: string;
	subject: string;
	redis: unknown;
	postgres: unknown;
};

const NO_BAN_ADDRESS = "ban_none";
const NO_BLOCKCHAIN_ADDRESS = "0x0000000000000000000000000000000000000000";
const PARALLEL = 16;
const HISTORY_LIMIT = 1000;

function sampleOf<T>(items: T[], size: number | undefined): T[] {
	if (size === undefined || size >= items.length) {
		return items;
	}
	const pool = [...items];
	for (let i = pool.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, size);
}

async function inBatches<T>(
	items: T[],
	work: (item: T) => Promise<void>
): Promise<void> {
	for (let start = 0; start < items.length; start += PARALLEL) {
		// eslint-disable-next-line no-await-in-loop
		await Promise.all(items.slice(start, start + PARALLEL).map(work));
	}
}

async function storedBalances(
	redis: Redis,
	banAddresses: string[]
): Promise<Map<string, string>> {
	const pipeline = redis.pipeline();
	banAddresses.forEach((banAddress) =>
		pipeline.get(`ban-balance:${banAddress}`)
	);
	const replies = (await pipeline.exec()) ?? [];
	return new Map(
		banAddresses.map((banAddress, index) => [
			banAddress,
			(replies[index]?.[1] as string | null) ?? "0",
		])
	);
}

const balanceRoute = (balance: string | BigNumber) => ({
	balance: ethers.utils.formatEther(balance),
});

class Verifier {
	private redis: Redis;

	private db: Database;

	private plan: MigrationPlan;

	private redisLedger: UsersDepositsStorage;

	private postgresLedger: UsersDepositsStorage;

	private differences: Difference[] = [];

	private gaps = new Map<string, PlannedEntry | undefined>();

	constructor(redis: Redis, db: Database, plan: MigrationPlan) {
		this.redis = redis;
		this.db = db;
		this.plan = plan;
		plan.entries
			.filter((entry) => entry.recoveredFrom)
			.forEach((entry) =>
				this.gaps.set(recoveryKey(entry.kind, entry.ref), entry)
			);
		plan.discrepancies
			.filter((discrepancy) => discrepancy.kind === "unrecovered_audit")
			.forEach((discrepancy) => {
				const { kind, ref } = discrepancy.details as {
					kind: HistoryKind;
					ref: string;
				};
				this.gaps.set(recoveryKey(kind, ref), undefined);
			});
		this.redisLedger = new RedisUsersDepositsStorage(redis);
		this.postgresLedger = new PostgresUsersDepositsStorage(
			db,
			new LedgerMarker(redis)
		);
	}

	private compare(
		check: string,
		subject: string,
		redis: unknown,
		postgres: unknown
	): void {
		if (isDeepStrictEqual(redis, postgres)) {
			return;
		}
		this.differences.push({ check, subject, redis, postgres });
	}

	private async compareHistory(
		check: string,
		subject: string,
		{ kind, key }: { kind: HistoryKind; key: string },
		redisItems: HistoryItem[],
		postgresItems: HistoryItem[]
	): Promise<void> {
		const members = await this.redis.zrevrangebyscore(
			key,
			"+inf",
			"-inf",
			"LIMIT",
			0,
			HISTORY_LIMIT
		);
		if (!members.some((member) => this.gaps.has(recoveryKey(kind, member)))) {
			this.compare(check, subject, redisItems, postgresItems);
			return;
		}
		const expected = members.flatMap((member, index) => {
			const id = recoveryKey(kind, member);
			if (!this.gaps.has(id)) {
				return [redisItems[index]];
			}
			const recovered = this.gaps.get(id);
			return recovered ? [historyItem(historyRowOf(recovered))] : [];
		});
		const windowIsComplete = members.length < HISTORY_LIMIT;
		this.compare(
			check,
			subject,
			expected,
			windowIsComplete ? postgresItems : postgresItems.slice(0, expected.length)
		);
	}

	async run(sample?: number): Promise<Difference[]> {
		await this.compareRowCounts();
		const stored = await storedBalances(
			this.redis,
			this.plan.accounts.map((account) => account.banAddress)
		);
		await this.compareBalances(stored);
		const banAddresses = sampleOf(
			this.plan.accounts.map((account) => account.banAddress),
			sample
		);
		const blockchainAddresses = sampleOf(
			[
				...new Set(
					this.plan.entries
						.filter((entry) => entry.kind === "swap_to_ban")
						.map((entry) => entry.blockchainAddress ?? "")
				),
			],
			sample
		);
		await inBatches(banAddresses, (banAddress) =>
			this.compareAccountRoutes(banAddress, stored.get(banAddress) ?? "0")
		);
		await inBatches(blockchainAddresses, (blockchainAddress) =>
			this.compareUnwraps(blockchainAddress)
		);
		await this.compareClaimsAndRest();
		return this.differences;
	}

	private async compareClaimsAndRest(): Promise<void> {
		await inBatches(
			this.plan.claims,
			async ({ banAddress, blockchainAddress, status }) => {
				const migrated =
					status === "pending"
						? await this.postgresLedger.hasPendingClaim(banAddress)
						: await this.postgresLedger.hasClaim(banAddress, blockchainAddress);
				this.compare(
					`${status} claim`,
					`${banAddress} ${blockchainAddress}`,
					true,
					migrated
				);
			}
		);
		await inBatches(this.plan.gasless, async ({ banAddress }) =>
			this.compare(
				"gasless swap",
				banAddress,
				await this.redisLedger.isFreeSwapAlreadyDone(banAddress),
				await this.postgresLedger.isFreeSwapAlreadyDone(banAddress)
			)
		);
		this.compare(
			"scan progress",
			"blockchain:blocks:latest",
			await this.redisLedger.getLastBlockchainBlockProcessed(),
			await this.postgresLedger.getLastBlockchainBlockProcessed()
		);
	}

	private async compareRowCounts(): Promise<void> {
		const counts = await countTargetRows(this.db);
		const expected: Record<string, number> = {
			accounts: this.plan.accounts.length,
			ledger_entries: this.plan.entries.length,
			claims: this.plan.claims.length,
			gasless_swaps: this.plan.gasless.length,
			scan_state: this.plan.lastBlockProcessed === undefined ? 0 : 1,
			migration_discrepancies: this.plan.discrepancies.length,
		};
		Object.entries(expected).forEach(([table, count]) =>
			this.compare("row count", table, count, counts[table])
		);
	}

	private async compareBalances(stored: Map<string, string>): Promise<void> {
		const rows = await this.db
			.select({ banAddress: accounts.banAddress, balance: accounts.balance })
			.from(accounts);
		const migrated = new Map(rows.map((row) => [row.banAddress, row.balance]));
		stored.forEach((balance, banAddress) =>
			this.compare("balance", banAddress, balance, migrated.get(banAddress))
		);
		const [{ total }] = await this.db
			.select({
				total: sql<string>`coalesce(sum(${accounts.balance}), 0)::text`,
			})
			.from(accounts);
		const storedTotal = [...stored.values()]
			.reduce((sum, balance) => sum.add(balance), BigNumber.from(0))
			.toString();
		this.compare("sum of balances", "accounts", storedTotal, total);
	}

	private async compareAccountRoutes(
		banAddress: string,
		stored: string
	): Promise<void> {
		this.compare(
			"GET /deposits/ban/:ban",
			banAddress,
			balanceRoute(stored),
			balanceRoute(
				await this.postgresLedger.getUserAvailableBalance(banAddress)
			)
		);
		await this.compareHistory(
			"deposits",
			banAddress,
			{ kind: "deposit", key: `deposits:${banAddress}` },
			await this.redisLedger.getDeposits(banAddress),
			await this.postgresLedger.getDeposits(banAddress)
		);
		await this.compareHistory(
			"withdrawals",
			banAddress,
			{ kind: "withdrawal", key: `withdrawals:${banAddress}` },
			await this.redisLedger.getWithdrawals(banAddress),
			await this.postgresLedger.getWithdrawals(banAddress)
		);
		await this.compareHistory(
			"swaps by BAN address",
			banAddress,
			{ kind: "swap_to_wban", key: `swaps:ban-to-wban:${banAddress}` },
			await this.redisLedger.getSwaps(NO_BLOCKCHAIN_ADDRESS, banAddress),
			await this.postgresLedger.getSwaps(NO_BLOCKCHAIN_ADDRESS, banAddress)
		);
	}

	private async compareUnwraps(blockchainAddress: string): Promise<void> {
		await this.compareHistory(
			"swaps by blockchain address",
			blockchainAddress,
			{ kind: "swap_to_ban", key: `swaps:wban-to-ban:${blockchainAddress}` },
			await this.redisLedger.getSwaps(blockchainAddress, NO_BAN_ADDRESS),
			await this.postgresLedger.getSwaps(blockchainAddress, NO_BAN_ADDRESS)
		);
	}
}

export async function verifyMigration(
	redis: Redis,
	db: Database,
	plan: MigrationPlan,
	sample?: number
): Promise<Difference[]> {
	return new Verifier(redis, db, plan).run(sample);
}

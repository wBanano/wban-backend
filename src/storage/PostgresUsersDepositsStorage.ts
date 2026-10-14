import { Logger } from "tslog";
import { BigNumber, ethers } from "ethers";
import { and, desc, eq, gt, or, sql, SQL } from "drizzle-orm";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import SwapWBANToBan from "../models/operations/SwapWBANToBan";
import InsufficientBalanceError from "../errors/InsufficientBalanceError";
import config from "../ledgerConfig";
import { LedgerMarker } from "./LedgerMarker";
import {
	Database,
	assertChainMatches,
	assertSchemaIsCurrent,
	chainIdentityFromConfig,
} from "./postgres/database";
import {
	accounts,
	claims,
	gaslessSwaps,
	ledgerEntries,
	scanState,
} from "./postgres/schema";
import {
	HistoryItem,
	depositHistoryItem,
	swapToBanHistoryItem,
	swapToWBanHistoryItem,
	withdrawalHistoryItem,
} from "./postgres/history";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type LedgerEntry = typeof ledgerEntries.$inferSelect;

type NewLedgerEntry = typeof ledgerEntries.$inferInsert & {
	banAddress: string;
	amount: string;
};

const HISTORY_LIMIT = 1000;

const PENDING_CLAIM_TTL = sql`interval '5 minutes'`;

const livePendingClaim = () =>
	and(eq(claims.status, "pending"), gt(claims.expiresAt, sql`now()`));

const WITHDRAWAL_ALREADY_PROCESSED =
	"Can't withdraw BAN as the transaction was already processed";

function isUniqueViolation(err: unknown, constraint: string): boolean {
	const cause = (err as { cause?: { code?: string; constraint?: string } })
		?.cause;
	return cause?.code === "23505" && cause.constraint === constraint;
}

class PostgresUsersDepositsStorage implements UsersDepositsStorage {
	private db: Database;

	private marker: LedgerMarker;

	private log: Logger = config.Logger.getChildLogger();

	constructor(db: Database, marker: LedgerMarker) {
		this.db = db;
		this.marker = marker;
	}

	async assertReady(): Promise<void> {
		await assertSchemaIsCurrent(this.db);
		await assertChainMatches(this.db, chainIdentityFromConfig());
		await this.marker.markOnPostgres();
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		const [account] = await this.db
			.select({ balance: accounts.balance })
			.from(accounts)
			.where(eq(accounts.banAddress, from.toLowerCase()));
		return BigNumber.from(account?.balance ?? 0);
	}

	async hasPendingClaim(banAddress: string): Promise<boolean> {
		return this.claimExists(
			and(eq(claims.banAddress, banAddress.toLowerCase()), livePendingClaim())
		);
	}

	async storePendingClaim(
		banAddress: string,
		blockchainAddress: string
	): Promise<boolean> {
		const ban = banAddress.toLowerCase();
		const blockchain = blockchainAddress.toLowerCase();
		try {
			await this.db.transaction(async (tx) => {
				await tx
					.delete(claims)
					.where(
						and(
							eq(claims.banAddress, ban),
							eq(claims.status, "pending"),
							sql`${claims.expiresAt} <= now()`
						)
					);
				await tx
					.insert(claims)
					.values({
						banAddress: ban,
						blockchainAddress: blockchain,
						status: "pending",
						expiresAt: sql`now() + ${PENDING_CLAIM_TTL}`,
					})
					.onConflictDoUpdate({
						target: [claims.banAddress, claims.blockchainAddress],
						set: { expiresAt: sql`now() + ${PENDING_CLAIM_TTL}` },
						setWhere: eq(claims.status, "pending"),
					});
			});
			this.log.info(`Stored pending claim for ${ban} and ${blockchain}`);
			return true;
		} catch (err) {
			this.log.error(err);
			return false;
		}
	}

	async isClaimed(banAddress: string): Promise<boolean> {
		return this.claimExists(
			and(
				eq(claims.banAddress, banAddress.toLowerCase()),
				eq(claims.status, "confirmed")
			)
		);
	}

	async isClaimedFromETH(blockchainAddress: string): Promise<boolean> {
		return this.claimExists(
			and(
				eq(claims.blockchainAddress, blockchainAddress.toLowerCase()),
				or(eq(claims.status, "confirmed"), livePendingClaim())
			)
		);
	}

	async hasClaim(
		banAddress: string,
		blockchainAddress: string
	): Promise<boolean> {
		return this.claimExists(
			and(
				eq(claims.banAddress, banAddress.toLowerCase()),
				eq(claims.blockchainAddress, blockchainAddress.toLowerCase()),
				eq(claims.status, "confirmed")
			)
		);
	}

	async confirmClaim(banAddress: string): Promise<boolean> {
		const confirmed = await this.db
			.update(claims)
			.set({ status: "confirmed", confirmedAt: sql`now()`, expiresAt: null })
			.where(
				and(eq(claims.banAddress, banAddress.toLowerCase()), livePendingClaim())
			)
			.returning({ blockchainAddress: claims.blockchainAddress });
		if (confirmed.length === 0) {
			this.log.warn(`No live pending claim to confirm for ${banAddress}`);
			return false;
		}
		this.log.info(
			`Stored claim for ${banAddress} with ${confirmed[0].blockchainAddress}`
		);
		return true;
	}

	async getBanAddressesForBlockchainAddress(
		blockchainAddress: string
	): Promise<Array<string>> {
		const rows = await this.db
			.select({ banAddress: claims.banAddress })
			.from(claims)
			.where(
				and(
					eq(claims.blockchainAddress, blockchainAddress.toLowerCase()),
					eq(claims.status, "confirmed")
				)
			)
			.orderBy(sql`${claims.confirmedAt} desc nulls last`, claims.banAddress);
		return rows.map((row) => row.banAddress);
	}

	async storeUserDeposit(
		banAddress: string,
		amount: BigNumber,
		timestamp: number,
		hash: string
	): Promise<void> {
		const stored = await this.credit({
			banAddress: banAddress.toLowerCase(),
			kind: "deposit",
			amount: amount.toString(),
			ref: hash,
			occurredAt: new Date(timestamp),
		});
		this.log.info(
			`${
				stored ? "Stored" : "Skipped already stored"
			} user deposit from: ${banAddress.toLowerCase()}, amount: ${ethers.utils.formatEther(
				amount
			)} BAN, hash: ${hash}`
		);
	}

	async containsUserDepositTransaction(
		banAddress: string,
		hash: string
	): Promise<boolean> {
		return this.entryExists(
			and(
				eq(ledgerEntries.kind, "deposit"),
				eq(ledgerEntries.ref, hash),
				eq(ledgerEntries.banAddress, banAddress.toLowerCase())
			)
		);
	}

	async reserveUserWithdrawal(
		banAddress: string,
		amount: BigNumber,
		timestamp: number
	): Promise<void> {
		try {
			await this.debit({
				banAddress: banAddress.toLowerCase(),
				kind: "withdrawal",
				status: "reserved",
				amount: amount.toString(),
				requestTimestamp: timestamp,
				occurredAt: new Date(timestamp),
			});
		} catch (err) {
			if (isUniqueViolation(err, "ledger_entries_withdrawal_request")) {
				throw new Error(WITHDRAWAL_ALREADY_PROCESSED);
			}
			throw err;
		}
		this.log.info(
			`Reserved withdrawal of ${ethers.utils.formatEther(
				amount
			)} BAN for ${banAddress.toLowerCase()} requested at ${timestamp}`
		);
	}

	async storeUserWithdrawal(
		banAddress: string,
		amount: BigNumber,
		timestamp: number,
		hash: string
	): Promise<void> {
		const request = and(
			eq(ledgerEntries.kind, "withdrawal"),
			eq(ledgerEntries.banAddress, banAddress.toLowerCase()),
			eq(ledgerEntries.requestTimestamp, timestamp),
			eq(ledgerEntries.amount, amount.toString())
		);
		const sent = await this.db
			.update(ledgerEntries)
			.set({ status: "sent", ref: hash, updatedAt: sql`now()` })
			.where(and(request, eq(ledgerEntries.status, "reserved")))
			.returning({ id: ledgerEntries.id });
		if (sent.length > 0) {
			this.log.info(
				`Stored user withdrawal from: ${banAddress.toLowerCase()}, amount: ${ethers.utils.formatEther(
					amount
				)} BAN, hash: ${hash}`
			);
			return;
		}
		if (
			await this.entryExists(
				and(
					request,
					eq(ledgerEntries.status, "sent"),
					eq(ledgerEntries.ref, hash)
				)
			)
		) {
			return;
		}
		throw new Error(
			`No reserved withdrawal of ${amount} for ${banAddress} requested at ${timestamp} to mark as sent with ${hash}`
		);
	}

	async containsUserWithdrawalRequest(
		banAddress: string,
		timestamp: number
	): Promise<boolean> {
		return this.entryExists(
			and(
				eq(ledgerEntries.kind, "withdrawal"),
				eq(ledgerEntries.banAddress, banAddress.toLowerCase()),
				eq(ledgerEntries.requestTimestamp, timestamp)
			)
		);
	}

	async storeUserSwapToWBan(
		banAddress: string,
		blockchainAddress: string,
		amount: BigNumber,
		timestamp: number,
		receipt: string,
		uuid: string
	): Promise<void> {
		if (!banAddress) {
			throw new Error("Missing BAN address");
		}
		await this.debit({
			banAddress: banAddress.toLowerCase(),
			kind: "swap_to_wban",
			amount: amount.toString(),
			ref: receipt,
			blockchainAddress: blockchainAddress.toLowerCase(),
			uuid: String(uuid),
			occurredAt: new Date(timestamp),
		});
		this.log.info(
			`Stored user swap from: ${banAddress.toLowerCase()}, amount: ${ethers.utils.formatEther(
				amount
			)} BAN, receipt: ${receipt}`
		);
	}

	async storeUserSwapToBan(swap: SwapWBANToBan): Promise<void> {
		if (!swap.banWallet) {
			throw new Error("Missing BAN address");
		}
		const stored = await this.credit({
			banAddress: swap.banWallet.toLowerCase(),
			kind: "swap_to_ban",
			amount: ethers.utils.parseEther(swap.amount).toString(),
			ref: swap.hash,
			blockchainAddress: swap.blockchainWallet.toLowerCase(),
			occurredAt: new Date(swap.timestamp),
		});
		if (!stored) {
			this.log.warn(`Swap for transaction "${swap.hash}" was already done.`);
			return;
		}
		this.log.info(
			`Stored user swap from wBAN of ${
				swap.amount
			} BAN from ${swap.blockchainWallet.toLowerCase()} to ${swap.banWallet.toLowerCase()} with hash: ${
				swap.hash
			}`
		);
	}

	async swapToBanWasAlreadyDone(swap: SwapWBANToBan): Promise<boolean> {
		return this.entryExists(
			and(
				eq(ledgerEntries.kind, "swap_to_ban"),
				eq(ledgerEntries.ref, swap.hash),
				eq(ledgerEntries.blockchainAddress, swap.blockchainWallet.toLowerCase())
			)
		);
	}

	async getLastBlockchainBlockProcessed(): Promise<number> {
		const [state] = await this.db
			.select({ block: scanState.lastBlockProcessed })
			.from(scanState);
		return (
			state?.block ?? config.BlockchainWalletPendingTransactionsStartFromBlock
		);
	}

	async setLastBlockchainBlockProcessed(block: number): Promise<void> {
		if (block <= (await this.getLastBlockchainBlockProcessed())) {
			return;
		}
		await this.db
			.insert(scanState)
			.values({ lastBlockProcessed: block })
			.onConflictDoUpdate({
				target: scanState.id,
				set: {
					lastBlockProcessed: sql`greatest(${scanState.lastBlockProcessed}, excluded.last_block_processed)`,
					updatedAt: sql`now()`,
				},
			});
	}

	async getDeposits(banAddress: string): Promise<Array<HistoryItem>> {
		const entries = await this.history(
			and(
				eq(ledgerEntries.banAddress, banAddress.toLowerCase()),
				eq(ledgerEntries.kind, "deposit")
			)
		);
		return entries.map(depositHistoryItem);
	}

	async getWithdrawals(banAddress: string): Promise<Array<HistoryItem>> {
		const entries = await this.history(
			and(
				eq(ledgerEntries.banAddress, banAddress.toLowerCase()),
				eq(ledgerEntries.kind, "withdrawal"),
				eq(ledgerEntries.status, "sent")
			)
		);
		return entries.map(withdrawalHistoryItem);
	}

	async getSwaps(
		blockchainAddress: string,
		banAddress: string
	): Promise<Array<HistoryItem>> {
		const toWBan = await this.history(
			and(
				eq(ledgerEntries.banAddress, banAddress.toLowerCase()),
				eq(ledgerEntries.kind, "swap_to_wban")
			)
		);
		const toBan = await this.history(
			and(
				eq(ledgerEntries.blockchainAddress, blockchainAddress.toLowerCase()),
				eq(ledgerEntries.kind, "swap_to_ban")
			)
		);
		return [
			...toWBan.map(swapToWBanHistoryItem),
			...toBan.map(swapToBanHistoryItem),
		];
	}

	async isFreeSwapAlreadyDone(from: string): Promise<boolean> {
		const [swap] = await this.db
			.select({ txnId: gaslessSwaps.txnId })
			.from(gaslessSwaps)
			.where(eq(gaslessSwaps.banAddress, from.toLowerCase()));
		return swap !== undefined;
	}

	async storeFreeSwap(from: string, txnId: string): Promise<void> {
		await this.db
			.insert(gaslessSwaps)
			.values({ banAddress: from.toLowerCase(), txnId })
			.onConflictDoUpdate({ target: gaslessSwaps.banAddress, set: { txnId } });
		this.log.info(`Stored gasless swap from ${from.toLowerCase()}`);
	}

	private async claimExists(where: SQL | undefined): Promise<boolean> {
		const rows = await this.db
			.select({ banAddress: claims.banAddress })
			.from(claims)
			.where(where)
			.limit(1);
		return rows.length > 0;
	}

	private async entryExists(where: SQL | undefined): Promise<boolean> {
		const rows = await this.db
			.select({ id: ledgerEntries.id })
			.from(ledgerEntries)
			.where(where)
			.limit(1);
		return rows.length > 0;
	}

	private async history(where: SQL | undefined): Promise<LedgerEntry[]> {
		return this.db
			.select()
			.from(ledgerEntries)
			.where(where)
			.orderBy(
				desc(ledgerEntries.occurredAt),
				sql`${ledgerEntries.ref} collate "C" desc`
			)
			.limit(HISTORY_LIMIT);
	}

	private async credit(entry: NewLedgerEntry): Promise<boolean> {
		return this.db.transaction(async (tx) => {
			const balance = await PostgresUsersDepositsStorage.lockAccount(
				tx,
				entry.banAddress
			);
			const inserted = await tx
				.insert(ledgerEntries)
				.values(entry)
				.onConflictDoNothing({
					target: [ledgerEntries.kind, ledgerEntries.ref],
				})
				.returning({ id: ledgerEntries.id });
			if (inserted.length === 0) {
				return false;
			}
			await PostgresUsersDepositsStorage.setBalance(
				tx,
				entry.banAddress,
				balance.add(entry.amount)
			);
			return true;
		});
	}

	private async debit(entry: NewLedgerEntry): Promise<void> {
		await this.db.transaction(async (tx) => {
			const balance = await PostgresUsersDepositsStorage.lockAccount(
				tx,
				entry.banAddress
			);
			if (balance.lt(entry.amount)) {
				throw new InsufficientBalanceError(
					`User "${entry.banAddress}" has not deposited enough BAN for ${
						entry.kind
					} of ${ethers.utils.formatEther(
						entry.amount
					)} BAN. Deposited balance is: ${ethers.utils.formatEther(
						balance
					)} BAN`
				);
			}
			await tx.insert(ledgerEntries).values(entry);
			await PostgresUsersDepositsStorage.setBalance(
				tx,
				entry.banAddress,
				balance.sub(entry.amount)
			);
		});
	}

	private static async lockAccount(
		tx: Transaction,
		banAddress: string
	): Promise<BigNumber> {
		await tx.insert(accounts).values({ banAddress }).onConflictDoNothing();
		const [account] = await tx
			.select({ balance: accounts.balance })
			.from(accounts)
			.where(eq(accounts.banAddress, banAddress))
			.for("update");
		return BigNumber.from(account.balance);
	}

	private static async setBalance(
		tx: Transaction,
		banAddress: string,
		balance: BigNumber
	): Promise<void> {
		await tx
			.update(accounts)
			.set({ balance: balance.toString(), updatedAt: sql`now()` })
			.where(eq(accounts.banAddress, banAddress));
	}
}

export { PostgresUsersDepositsStorage };

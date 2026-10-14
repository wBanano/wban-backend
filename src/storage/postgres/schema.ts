import { sql } from "drizzle-orm";
import {
	bigint,
	bigserial,
	check,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	smallint,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const ledgerKind = pgEnum("ledger_kind", [
	"deposit",
	"withdrawal",
	"swap_to_wban",
	"swap_to_ban",
]);

export const withdrawalStatus = pgEnum("withdrawal_status", [
	"reserved",
	"sent",
	"released",
]);

export const claimStatus = pgEnum("claim_status", ["pending", "confirmed"]);

export const chainMeta = pgTable(
	"chain_meta",
	{
		id: smallint("id").primaryKey().default(1),
		networkName: text("network_name").notNull(),
		chainId: integer("chain_id").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
	},
	(t) => [check("chain_meta_single_row", sql`${t.id} = 1`)]
);

export const accounts = pgTable(
	"accounts",
	{
		banAddress: text("ban_address").primaryKey(),
		balance: amount("balance").notNull().default("0"),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(t) => [
		check(
			"accounts_ban_address_lowercase",
			sql`${t.banAddress} = lower(${t.banAddress})`
		),
	]
);

export const ledgerEntries = pgTable(
	"ledger_entries",
	{
		id: bigserial("id", { mode: "number" }).primaryKey(),
		banAddress: text("ban_address")
			.notNull()
			.references(() => accounts.banAddress),
		kind: ledgerKind("kind").notNull(),
		amount: amount("amount").notNull(),
		ref: text("ref"),
		status: withdrawalStatus("status"),
		blockchainAddress: text("blockchain_address"),
		uuid: text("uuid"),
		requestTimestamp: bigint("request_timestamp", { mode: "number" }),
		occurredAt: timestamptz("occurred_at").notNull(),
		legacyAudit: jsonb("legacy_audit").$type<Record<string, string>>(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(t) => [
		unique("ledger_entries_kind_ref").on(t.kind, t.ref),
		uniqueIndex("ledger_entries_withdrawal_request")
			.on(t.banAddress, t.requestTimestamp)
			.where(sql`${t.kind} = 'withdrawal'`),
		index("ledger_entries_account_history").on(
			t.banAddress,
			t.kind,
			t.occurredAt.desc()
		),
		index("ledger_entries_blockchain_history")
			.on(t.blockchainAddress, t.kind, t.occurredAt.desc())
			.where(sql`${t.blockchainAddress} is not null`),
		index("ledger_entries_reserved_withdrawals")
			.on(t.createdAt)
			.where(sql`${t.status} = 'reserved'`),
		check("ledger_entries_amount_positive", sql`${t.amount} > 0`),
		check(
			"ledger_entries_withdrawal_fields",
			sql`(${t.kind} = 'withdrawal') = (${t.requestTimestamp} is not null and ${t.status} is not null)`
		),
		check(
			"ledger_entries_ref_once_settled",
			sql`(${t.ref} is not null) = (${t.kind} <> 'withdrawal' or ${t.status} = 'sent')`
		),
		check(
			"ledger_entries_blockchain_address_lowercase",
			sql`${t.blockchainAddress} = lower(${t.blockchainAddress})`
		),
	]
);

export const claims = pgTable(
	"claims",
	{
		banAddress: text("ban_address").notNull(),
		blockchainAddress: text("blockchain_address").notNull(),
		status: claimStatus("status").notNull(),
		createdAt: timestamptz("created_at").notNull().defaultNow(),
		expiresAt: timestamptz("expires_at"),
		confirmedAt: timestamptz("confirmed_at"),
	},
	(t) => [
		primaryKey({ columns: [t.banAddress, t.blockchainAddress] }),
		index("claims_blockchain_address").on(t.blockchainAddress),
		uniqueIndex("claims_one_pending_per_ban_address")
			.on(t.banAddress)
			.where(sql`${t.status} = 'pending'`),
		check(
			"claims_pending_expires",
			sql`(${t.status} = 'pending') = (${t.expiresAt} is not null)`
		),
		check(
			"claims_addresses_lowercase",
			sql`${t.banAddress} = lower(${t.banAddress}) and ${t.blockchainAddress} = lower(${t.blockchainAddress})`
		),
	]
);

export const gaslessSwaps = pgTable("gasless_swaps", {
	banAddress: text("ban_address").primaryKey(),
	txnId: text("txn_id").notNull(),
	createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const scanState = pgTable(
	"scan_state",
	{
		id: smallint("id").primaryKey().default(1),
		lastBlockProcessed: bigint("last_block_processed", {
			mode: "number",
		}).notNull(),
		updatedAt: timestamptz("updated_at").notNull().defaultNow(),
	},
	(t) => [check("scan_state_single_row", sql`${t.id} = 1`)]
);

export const migrationDiscrepancies = pgTable("migration_discrepancies", {
	id: bigserial("id", { mode: "number" }).primaryKey(),
	kind: text("kind").notNull(),
	banAddress: text("ban_address"),
	redisKey: text("redis_key"),
	storedBalance: amount("stored_balance"),
	recomputedBalance: amount("recomputed_balance"),
	details: jsonb("details").notNull().default({}),
	createdAt: timestamptz("created_at").notNull().defaultNow(),
});

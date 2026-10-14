CREATE TYPE "public"."claim_status" AS ENUM('pending', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('deposit', 'withdrawal', 'swap_to_wban', 'swap_to_ban');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('reserved', 'sent', 'released');--> statement-breakpoint
CREATE TABLE "accounts" (
	"ban_address" text PRIMARY KEY NOT NULL,
	"balance" numeric(78, 0) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_ban_address_lowercase" CHECK ("accounts"."ban_address" = lower("accounts"."ban_address"))
);
--> statement-breakpoint
CREATE TABLE "chain_meta" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"network_name" text NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_meta_single_row" CHECK ("chain_meta"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"ban_address" text NOT NULL,
	"blockchain_address" text NOT NULL,
	"status" "claim_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "claims_ban_address_blockchain_address_pk" PRIMARY KEY("ban_address","blockchain_address"),
	CONSTRAINT "claims_pending_expires" CHECK (("claims"."status" = 'pending') = ("claims"."expires_at" is not null)),
	CONSTRAINT "claims_addresses_lowercase" CHECK ("claims"."ban_address" = lower("claims"."ban_address") and "claims"."blockchain_address" = lower("claims"."blockchain_address"))
);
--> statement-breakpoint
CREATE TABLE "gasless_swaps" (
	"ban_address" text PRIMARY KEY NOT NULL,
	"txn_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ban_address" text NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"ref" text,
	"status" "withdrawal_status",
	"blockchain_address" text,
	"uuid" text,
	"request_timestamp" bigint,
	"occurred_at" timestamp with time zone NOT NULL,
	"legacy_audit" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_kind_ref" UNIQUE("kind","ref"),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount" > 0),
	CONSTRAINT "ledger_entries_withdrawal_fields" CHECK (("ledger_entries"."kind" = 'withdrawal') = ("ledger_entries"."request_timestamp" is not null and "ledger_entries"."status" is not null)),
	CONSTRAINT "ledger_entries_ref_once_settled" CHECK (("ledger_entries"."ref" is not null) = ("ledger_entries"."kind" <> 'withdrawal' or "ledger_entries"."status" = 'sent')),
	CONSTRAINT "ledger_entries_blockchain_address_lowercase" CHECK ("ledger_entries"."blockchain_address" = lower("ledger_entries"."blockchain_address"))
);
--> statement-breakpoint
CREATE TABLE "migration_discrepancies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ban_address" text,
	"redis_key" text,
	"stored_balance" numeric(78, 0),
	"recomputed_balance" numeric(78, 0),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_block_processed" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_state_single_row" CHECK ("scan_state"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_ban_address_accounts_ban_address_fk" FOREIGN KEY ("ban_address") REFERENCES "public"."accounts"("ban_address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_blockchain_address" ON "claims" USING btree ("blockchain_address");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_one_pending_per_ban_address" ON "claims" USING btree ("ban_address") WHERE "claims"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_withdrawal_request" ON "ledger_entries" USING btree ("ban_address","request_timestamp") WHERE "ledger_entries"."kind" = 'withdrawal';--> statement-breakpoint
CREATE INDEX "ledger_entries_account_history" ON "ledger_entries" USING btree ("ban_address","kind","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ledger_entries_blockchain_history" ON "ledger_entries" USING btree ("blockchain_address","kind","occurred_at" DESC NULLS LAST) WHERE "ledger_entries"."blockchain_address" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_reserved_withdrawals" ON "ledger_entries" USING btree ("created_at") WHERE "ledger_entries"."status" = 'reserved';
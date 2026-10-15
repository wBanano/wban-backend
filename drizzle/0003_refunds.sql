CREATE TYPE "public"."refund_status" AS ENUM('reserved', 'sent');--> statement-breakpoint
CREATE TABLE "refunds" (
	"deposit_hash" text PRIMARY KEY NOT NULL,
	"ban_address" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"status" "refund_status" DEFAULT 'reserved' NOT NULL,
	"send_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_amount_positive" CHECK ("refunds"."amount" > 0),
	CONSTRAINT "refunds_send_hash_once_sent" CHECK (("refunds"."status" = 'sent') = ("refunds"."send_hash" is not null)),
	CONSTRAINT "refunds_ban_address_lowercase" CHECK ("refunds"."ban_address" = lower("refunds"."ban_address"))
);
--> statement-breakpoint
CREATE INDEX "refunds_reserved" ON "refunds" USING btree ("created_at") WHERE "refunds"."status" = 'reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_send_hash" ON "refunds" USING btree ("send_hash") WHERE "refunds"."send_hash" is not null;
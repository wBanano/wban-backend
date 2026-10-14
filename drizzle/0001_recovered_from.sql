CREATE TYPE "public"."recovery_source" AS ENUM('banano_node', 'swap_to_ban_event');--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "recovered_from" "recovery_source";
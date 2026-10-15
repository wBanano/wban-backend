import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers } from "ethers";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import InsufficientBalanceError from "../../src/errors/InsufficientBalanceError";
import { LedgerMarker } from "../../src/storage/LedgerMarker";
import { LedgerHealth } from "../../src/storage/postgres/LedgerHealth";
import { WithdrawalReservations } from "../../src/storage/postgres/WithdrawalReservations";
import { RefundReservations } from "../../src/storage/postgres/RefundReservations";
import {
	assertSchemaIsCurrent,
	chainIdentityFromConfig,
	createDatabase,
	migrateDatabase,
} from "../../src/storage/postgres/database";
import {
	chainMeta,
	claims,
	ledgerEntries,
	migrationDiscrepancies,
	accounts,
	refunds,
} from "../../src/storage/postgres/schema";
import { PostgresHarness, postgresLedger } from "../helpers/ledgers";

const { expect } = chai;
chai.use(chaiAsPromised);

const BAN = (amount: string) => ethers.utils.parseEther(amount);
const ALICE = "ban_1alice";
const BOB = "ban_1bob";
const WALLET = "0xabc0000000000000000000000000000000000001";
const T0 = 1_700_000_000_000;

describe("Postgres ledger", () => {
	let ledger: PostgresHarness;
	let svc: UsersDepositsService;
	let reservations: WithdrawalReservations;
	let health: LedgerHealth;

	beforeEach(async () => {
		ledger = await postgresLedger();
		svc = new UsersDepositsService(ledger.storage);
		reservations = new WithdrawalReservations(ledger.db);
		health = new LedgerHealth(ledger.db);
		await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
	});

	afterEach(async () => {
		await ledger.close();
	});

	const balance = async () =>
		(await svc.getUserAvailableBalance(ALICE)).toString();

	describe("Debits", () => {
		it("refuses a wrap above the balance and writes nothing", async () => {
			await expect(
				svc.storeUserSwapToWBan(ALICE, WALLET, BAN("11"), T0, "0xr", "1")
			).to.be.rejectedWith(InsufficientBalanceError);
			expect(await balance()).to.equal(BAN("10").toString());
			expect(await svc.getSwaps(WALLET, ALICE)).to.have.length(0);
		});

		it("lets only one of two concurrent withdrawals overdraw", async () => {
			const results = await Promise.allSettled([
				svc.reserveUserWithdrawal(ALICE, BAN("6"), T0 + 1),
				svc.reserveUserWithdrawal(ALICE, BAN("6"), T0 + 2),
			]);
			const rejected = results.filter((r) => r.status === "rejected");
			expect(rejected).to.have.length(1);
			expect((rejected[0] as PromiseRejectedResult).reason).to.be.instanceOf(
				InsufficientBalanceError
			);
			expect(await balance()).to.equal(BAN("4").toString());
		});

		it("rejects a second reservation of the same request", async () => {
			await svc.reserveUserWithdrawal(ALICE, BAN("1"), T0 + 1);
			await expect(
				svc.reserveUserWithdrawal(ALICE, BAN("1"), T0 + 1)
			).to.be.rejectedWith("already processed");
		});
	});

	describe("Withdrawal reservations", () => {
		beforeEach(async () => {
			await svc.reserveUserWithdrawal(ALICE, BAN("3"), T0 + 1);
		});

		it("debits on reservation and keeps it out of the history", async () => {
			expect(await balance()).to.equal(BAN("7").toString());
			expect(await svc.getWithdrawals(ALICE)).to.have.length(0);
			expect(
				await svc.containsUserWithdrawalRequest({
					banWallet: ALICE,
					blockchainWallet: WALLET,
					amount: "3",
					timestamp: T0 + 1,
				})
			).to.equal(true);
		});

		it("refuses to mark an unknown withdrawal as sent", async () => {
			await expect(
				svc.storeUserWithdrawal(ALICE, BAN("3"), T0 + 99, "W9")
			).to.be.rejectedWith("No reserved withdrawal");
		});

		it("reports a reservation older than 10 minutes as stuck", async () => {
			expect(await health.stuckWithdrawals()).to.have.length(0);
			await ledger.db
				.update(ledgerEntries)
				.set({ createdAt: sql`now() - interval '11 minutes'` })
				.where(eq(ledgerEntries.kind, "withdrawal"));
			const stuck = await health.stuckWithdrawals();
			expect(stuck).to.have.length(1);
			expect(stuck[0]).to.include({
				banAddress: ALICE,
				amount: BAN("3").toString(),
				requestTimestamp: T0 + 1,
			});
		});

		it("confirms a stuck reservation with its block hash", async () => {
			const [reserved] = await reservations.list();
			await reservations.confirm(reserved.id, "W1");
			expect(await svc.getWithdrawals(ALICE)).to.have.length(1);
			expect(await reservations.recordedSendHashes(["W1", "W2"])).to.have.keys(
				"W1"
			);
			await expect(reservations.confirm(reserved.id, "W2")).to.be.rejectedWith(
				"is not reserved"
			);
		});

		it("releases a stuck reservation back into the balance", async () => {
			const [reserved] = await reservations.list();
			await reservations.release(reserved.id);
			expect(await balance()).to.equal(BAN("10").toString());
			expect(await reservations.get(reserved.id)).to.equal(undefined);
			expect(await health.balanceMismatches()).to.have.length(0);
			await expect(reservations.release(reserved.id)).to.be.rejectedWith(
				"is not reserved"
			);
		});
	});

	describe("Refunds", () => {
		it("reserves a refund once per deposit and never credits it afterwards", async () => {
			expect(await svc.reserveRefund("R1", BOB, BAN("2"))).to.equal(true);
			expect(await svc.reserveRefund("R1", BOB, BAN("2"))).to.equal(false);
			await svc.storeUserDeposit(BOB, BAN("2"), T0, "R1");
			expect((await svc.getUserAvailableBalance(BOB)).toString()).to.equal("0");
			expect(await svc.getDeposits(BOB)).to.have.length(0);
		});

		it("refuses to refund a deposit that was credited", async () => {
			expect(await svc.reserveRefund("D1", ALICE, BAN("10"))).to.equal(false);
			expect(await balance()).to.equal(BAN("10").toString());
		});

		it("marks a refund sent once and reports one reserved for 10 minutes as stuck", async () => {
			await svc.reserveRefund("R1", BOB, BAN("2"));
			await svc.reserveRefund("R2", BOB, BAN("3"));
			await ledger.db
				.update(refunds)
				.set({ createdAt: sql`now() - interval '11 minutes'` });
			await svc.storeRefund("R1", "S1");
			await expect(svc.storeRefund("R1", "S2")).to.be.rejectedWith(
				"No reserved refund"
			);
			const stuck = await health.stuckRefunds();
			expect(
				stuck.map((refund) => [
					refund.depositHash,
					refund.banAddress,
					refund.amount,
				])
			).to.deep.equal([["R2", BOB, BAN("3").toString()]]);
			expect((await health.report()).stuckRefunds).to.have.length(1);
		});

		it("tells whether a deposit was sent back", async () => {
			expect(await svc.hasRefund("R1")).to.equal(false);
			await svc.reserveRefund("R1", BOB, BAN("2"));
			expect(await svc.hasRefund("R1")).to.equal(true);
		});

		it("records a send hash for one refund only", async () => {
			await svc.reserveRefund("R1", BOB, BAN("2"));
			await svc.reserveRefund("R2", BOB, BAN("2"));
			await svc.storeRefund("R1", "S1");
			const err = await svc.storeRefund("R2", "S1").catch((e) => e);
			expect(err.cause).to.include({ constraint: "refunds_send_hash" });
		});

		it("sees an open withdrawal and an open refund that look the same", async () => {
			const refundReservations = new RefundReservations(ledger.db);
			await svc.reserveUserWithdrawal(ALICE, BAN("2"), T0 + 1);
			await svc.reserveRefund("R1", ALICE, BAN("2"));
			const [withdrawal] = await reservations.list();
			const [refund] = await refundReservations.list();
			expect(await reservations.otherOpenSends(withdrawal)).to.deep.equal([
				{ kind: "refund", id: "R1" },
			]);
			expect(await refundReservations.otherOpenSends(refund)).to.deep.equal([
				{ kind: "withdrawal", id: String(withdrawal.id) },
			]);
			await svc.storeUserWithdrawal(ALICE, BAN("2"), T0 + 1, "W1");
			expect(
				await refundReservations.recordedSendHashes(["W1", "S9"])
			).to.have.keys("W1");
		});

		it("confirms a stuck refund with an unrecorded send", async () => {
			const refundReservations = new RefundReservations(ledger.db);
			await svc.reserveRefund("R1", BOB, BAN("2"));
			await svc.reserveRefund("R2", BOB, BAN("2"));
			await svc.storeRefund("R2", "S2");
			expect(await refundReservations.get("R1")).to.include({
				banAddress: BOB,
				amount: BAN("2").toString(),
			});
			expect(await refundReservations.get("R2")).to.equal(undefined);
			expect(
				await refundReservations.recordedSendHashes(["S1", "S2"])
			).to.have.keys("S2");
			await refundReservations.confirm("R1", "S1");
			expect(await refundReservations.list()).to.have.length(0);
			await expect(refundReservations.confirm("R1", "S3")).to.be.rejectedWith(
				"is not reserved"
			);
		});
	});

	describe("Balance recompute", () => {
		it("matches the entries after every kind of change", async () => {
			await svc.storeUserSwapToWBan(
				ALICE,
				WALLET,
				BAN("4"),
				T0 + 1,
				"0xr",
				"1"
			);
			await svc.storeUserSwapToBan({
				blockchainWallet: WALLET,
				banWallet: ALICE,
				amount: "2",
				wbanBalance: "0.0",
				hash: "0xtx",
				timestamp: T0 + 2,
			});
			await svc.reserveUserWithdrawal(ALICE, BAN("1"), T0 + 3);
			expect(await health.balanceMismatches()).to.deep.equal([]);
		});

		it("reports a balance that drifted from its entries", async () => {
			await ledger.db
				.update(accounts)
				.set({ balance: BAN("12").toString() })
				.where(eq(accounts.banAddress, ALICE));
			expect(await health.balanceMismatches()).to.deep.equal([
				{
					banAddress: ALICE,
					balance: BAN("12").toString(),
					expected: BAN("10").toString(),
				},
			]);
		});

		it("accepts a drift recorded as a migration discrepancy", async () => {
			await ledger.db
				.update(accounts)
				.set({ balance: BAN("12").toString() })
				.where(eq(accounts.banAddress, ALICE));
			await ledger.db.insert(migrationDiscrepancies).values({
				kind: "balance_mismatch",
				banAddress: ALICE,
				storedBalance: BAN("12").toString(),
				recomputedBalance: BAN("10").toString(),
			});
			expect(await health.balanceMismatches()).to.deep.equal([]);
		});
	});

	describe("Claims", () => {
		it("allows a single live pending claim per BAN address", async () => {
			expect(await svc.storePendingClaim(BOB, WALLET)).to.equal(true);
			expect(
				await svc.storePendingClaim(
					BOB,
					"0xdef0000000000000000000000000000000000002"
				)
			).to.equal(false);
		});

		it("relinks the most recently confirmed claim first", async () => {
			await svc.storePendingClaim(BOB, WALLET);
			await svc.confirmClaim(BOB);
			await svc.storePendingClaim(ALICE, WALLET);
			await svc.confirmClaim(ALICE);
			expect(
				await svc.getBanAddressesForBlockchainAddress(WALLET)
			).to.deep.equal([ALICE, BOB]);
		});

		it("relinks migrated claims without a confirmation time last, by BAN address", async () => {
			await ledger.db.insert(claims).values([
				{
					banAddress: "ban_1zed",
					blockchainAddress: WALLET,
					status: "confirmed",
				},
				{
					banAddress: "ban_1amy",
					blockchainAddress: WALLET,
					status: "confirmed",
				},
			]);
			await svc.storePendingClaim(BOB, WALLET);
			await svc.confirmClaim(BOB);
			expect(
				await svc.getBanAddressesForBlockchainAddress(WALLET)
			).to.deep.equal([BOB, "ban_1amy", "ban_1zed"]);
		});

		it("confirms nothing once the pending claim expired", async () => {
			await svc.storePendingClaim(BOB, WALLET);
			await ledger.expirePendingClaims();
			expect(await svc.confirmClaim(BOB)).to.equal(false);
			expect(await svc.isClaimed(BOB)).to.equal(false);
		});
	});

	describe("Legacy history rows", () => {
		it("renders the migrated audit hash as it was", async () => {
			await ledger.db.insert(ledgerEntries).values({
				banAddress: ALICE,
				kind: "swap_to_ban",
				amount: BAN("1").toString(),
				ref: "0xold",
				blockchainAddress: WALLET,
				occurredAt: new Date(T0),
				legacyAudit: {
					type: "swap-to-ban",
					hash: "0xold",
					amount: BAN("1").toString(),
					timestamp: String(T0),
				},
			});
			const [unwrap] = await svc.getSwaps(WALLET, ALICE);
			expect(unwrap).to.deep.equal({
				type: "swap-to-ban",
				hash: "0xold",
				amount: BAN("1").toString(),
				timestamp: String(T0),
				link: unwrap.link,
			});
			expect(unwrap.link).to.match(/\/tx\/0xold$/);
		});
	});

	describe("Boot checks", () => {
		it("refuses to start without chain metadata", async () => {
			await expect(ledger.storage.assertReady()).to.be.rejectedWith(
				"chain_meta is empty"
			);
		});

		it("refuses to start on another chain's database", async () => {
			await ledger.db
				.insert(chainMeta)
				.values({ networkName: "bsc", chainId: 56 });
			await expect(ledger.storage.assertReady()).to.be.rejectedWith(
				"holds the ledger of bsc"
			);
		});

		it("starts on its own chain and marks the Redis ledger as moved", async () => {
			await ledger.db.insert(chainMeta).values(chainIdentityFromConfig());
			await ledger.storage.assertReady();
			expect(await new LedgerMarker(ledger.redis).isOnPostgres()).to.equal(
				true
			);
		});

		it("refuses to start when the schema differs from the build", async () => {
			await ledger.db.insert(chainMeta).values(chainIdentityFromConfig());
			const [{ hash }] = (
				await ledger.db.execute<{ hash: string }>(
					sql`select hash from drizzle.__drizzle_migrations order by created_at desc limit 1`
				)
			).rows;
			await ledger.db.execute(
				sql`update drizzle.__drizzle_migrations set hash = 'other' where hash = ${hash}`
			);
			try {
				await expect(ledger.storage.assertReady()).to.be.rejectedWith(
					"does not match this build"
				);
			} finally {
				await ledger.db.execute(
					sql`update drizzle.__drizzle_migrations set hash = ${hash} where hash = 'other'`
				);
			}
		});
	});

	describe("Migrations", () => {
		const scratchDatabase = "wban_migrate_test";
		let admin: Pool;
		let pool: Pool;

		beforeEach(async () => {
			admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
			await admin.query(`drop database if exists ${scratchDatabase}`);
			await admin.query(`create database ${scratchDatabase}`);
			const url = new URL(process.env.TEST_DATABASE_URL ?? "");
			url.pathname = `/${scratchDatabase}`;
			pool = new Pool({ connectionString: url.toString() });
		});

		afterEach(async () => {
			await pool.end();
			await admin.query(`drop database if exists ${scratchDatabase}`);
			await admin.end();
		});

		it("refuses an unmigrated database", async () => {
			await expect(
				assertSchemaIsCurrent(createDatabase(pool))
			).to.be.rejectedWith("not migrated");
		});

		it("migrates, records the chain and refuses another chain later", async () => {
			const db = createDatabase(pool);
			await migrateDatabase(db, { networkName: "polygon", chainId: 137 });
			await assertSchemaIsCurrent(db);
			await migrateDatabase(db, { networkName: "polygon", chainId: 137 });
			await expect(
				migrateDatabase(db, { networkName: "bsc", chainId: 56 })
			).to.be.rejectedWith("holds the ledger of polygon");
			await expect(
				migrateDatabase(db, { networkName: "", chainId: 0 })
			).to.be.rejectedWith("must be set");
		});
	});
});

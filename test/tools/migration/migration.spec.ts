import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import IORedis, { Redis } from "ioredis";
import { ethers } from "ethers";
import { eq, sql } from "drizzle-orm";
import { UsersDepositsService } from "../../../src/services/UsersDepositsService";
import { RedisUsersDepositsStorage } from "../../../src/storage/RedisUsersDepositsStorage";
import { chainIdentityFromConfig } from "../../../src/storage/postgres/database";
import { accounts, chainMeta } from "../../../src/storage/postgres/schema";
import { LedgerHealth } from "../../../src/storage/postgres/LedgerHealth";
import { readSnapshot } from "../../../src/tools/migration/snapshot";
import { planMigration } from "../../../src/tools/migration/plan";
import { writePlan } from "../../../src/tools/migration/write";
import { verifyMigration } from "../../../src/tools/migration/verify";
import { formatReport } from "../../../src/tools/migration/report";
import { PostgresHarness, postgresLedger } from "../../helpers/ledgers";

const { expect } = chai;
chai.use(chaiAsPromised);

const BAN = (amount: string) => ethers.utils.parseEther(amount);
const ALICE = "ban_1alice";
const BOB = "ban_1bob";
const LEGACY = "ban_1legacy";
const WALLET = "0xAbC0000000000000000000000000000000000001";
const T0 = 1_700_000_000_000;

const READ_COMMANDS = ["info", "scan", "get", "zrange", "hgetall"];

function recordingRedis(commands: Set<string>): Redis {
	const redis = new IORedis(process.env.TEST_REDIS_URL ?? "");
	const send = redis.sendCommand.bind(redis);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(redis as any).sendCommand = (command: any, ...rest: any[]) => {
		commands.add(String(command.name).toLowerCase());
		return send(command, ...rest);
	};
	return redis;
}

async function seedLedgerTheWayTheAppDoes(redis: Redis): Promise<void> {
	const svc = new UsersDepositsService(new RedisUsersDepositsStorage(redis));
	await svc.storePendingClaim(ALICE, WALLET);
	await svc.confirmClaim(ALICE);
	await svc.storePendingClaim(BOB, WALLET);
	await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
	await svc.storeUserDeposit(ALICE, BAN("5"), T0 + 10, "D2");
	await svc.storeUserSwapToWBan(
		ALICE,
		WALLET,
		BAN("4"),
		T0 + 20,
		"0xreceipt1",
		"1700000000020"
	);
	await svc.storeUserSwapToBan({
		blockchainWallet: WALLET,
		banWallet: ALICE,
		amount: "2.5",
		wbanBalance: "0.0",
		hash: "0xtx1",
		timestamp: T0 + 30,
	});
	await svc.reserveUserWithdrawal(ALICE, BAN("3"), T0 + 40);
	await svc.storeUserWithdrawal(ALICE, BAN("3"), T0 + 40, "W1");
	await svc.storeFreeSwap(ALICE, "txn-1");
	await svc.setLastBlockchainBlockProcessed(12_345);
}

async function seedLegacyShapes(redis: Redis): Promise<void> {
	const blockchain = WALLET.toLowerCase();
	await redis.zadd(`swaps:wban-to-ban:${blockchain}`, T0 - 1_000, "0xlegacy");
	await redis.hset("audit:0xlegacy", {
		type: "swap-to-ban",
		hash: "0xlegacy",
		amount: BAN("1").toString(),
		timestamp: T0 - 1_000,
	});
	await redis.set(`ban-balance:${LEGACY}`, BAN("1").toString());
	await redis.zadd(`swaps:ban-to-wban:${BOB}`, T0 - 2_000, "0xoldreceipt");
	await redis.hset("audit:0xoldreceipt", {
		type: "swap-to-wban",
		receipt: "0xoldreceipt",
		uuid: "1",
		amount: BAN("1").toString(),
		timestamp: T0 - 2_000,
	});
	await redis.set(`ban-balance:${BOB}`, BAN("-1").toString());
	await redis.hset("audit:0xorphan", { type: "deposit", amount: "1" });
	await redis.set("bull:operations-queue:1", "job");
	await redis.set("locks:ban-balance:ban_1x", "lock");
}

describe("Redis to Postgres migration", () => {
	let ledger: PostgresHarness;
	let seed: Redis;

	beforeEach(async () => {
		ledger = await postgresLedger();
		await ledger.db.insert(chainMeta).values(chainIdentityFromConfig());
		seed = new IORedis(process.env.TEST_REDIS_URL ?? "");
		await seed.flushdb();
		await seedLedgerTheWayTheAppDoes(seed);
		await seedLegacyShapes(seed);
	});

	afterEach(async () => {
		seed.disconnect();
		await ledger.close();
	});

	const plannedFrom = async (redis: Redis) =>
		planMigration(await readSnapshot(redis), {
			recoveredBanAddresses: new Map([["0xlegacy", LEGACY]]),
		});

	it("reads Redis with read commands only and reports what it found", async () => {
		const commands = new Set<string>();
		const redis = recordingRedis(commands);
		const snapshot = await readSnapshot(redis);
		const plan = planMigration(snapshot);
		redis.disconnect();
		expect([...commands]).to.satisfy((used: string[]) =>
			used.every((command) => READ_COMMANDS.includes(command))
		);
		expect(snapshot.keyCounts).to.include({
			bullmq: 1,
			locks: 1,
			"claims:pending": 2,
			claims: 1,
		});
		expect(plan.stats).to.include({
			unwrapsMissingBanAddress: 1,
			unwrapsRecovered: 0,
			pendingClaimsMigrated: 1,
		});
		expect(plan.blocking.map((issue) => issue.kind)).to.deep.equal([
			"unwrap_without_ban_address",
		]);
		const report = formatReport(snapshot, plan, undefined);
		expect(report).to.include(
			"Blocking issues (--write refuses while there are any): 1"
		);
		expect(report).to.include("audit:0xorphan");
	});

	it("writes the plan, recomputes cleanly and verifies against Redis", async () => {
		const plan = await plannedFrom(seed);
		expect(plan.blocking).to.deep.equal([]);
		await writePlan(ledger.db, plan);
		const commands = new Set<string>();
		const redis = recordingRedis(commands);
		expect(await verifyMigration(redis, ledger.db, plan)).to.deep.equal([]);
		redis.disconnect();
		expect([...commands]).to.satisfy((used: string[]) =>
			used.every((command) =>
				[...READ_COMMANDS, "zrevrangebyscore"].includes(command)
			)
		);
		expect(await new LedgerHealth(ledger.db).balanceMismatches()).to.deep.equal(
			[]
		);
		expect(
			await ledger.storage.getBanAddressesForBlockchainAddress(WALLET)
		).to.deep.equal([ALICE]);
	});

	it("refuses to write twice or with blocking issues", async () => {
		const plan = await plannedFrom(seed);
		await writePlan(ledger.db, plan);
		await expect(writePlan(ledger.db, plan)).to.be.rejectedWith(
			"already has rows"
		);
		await expect(
			writePlan(ledger.db, planMigration(await readSnapshot(seed)))
		).to.be.rejectedWith("blocking issues");
	});

	it("fails verification when a migrated balance differs", async () => {
		const plan = await plannedFrom(seed);
		await writePlan(ledger.db, plan);
		await ledger.db
			.update(accounts)
			.set({ balance: sql`${accounts.balance} + 1` })
			.where(eq(accounts.banAddress, ALICE));
		const differences = await verifyMigration(seed, ledger.db, plan);
		expect(differences.map((d) => d.check)).to.include.members([
			"balance",
			"sum of balances",
			"GET /deposits/ban/:ban",
		]);
	});

	it("verifies a random sample of accounts", async () => {
		const plan = await plannedFrom(seed);
		await writePlan(ledger.db, plan);
		expect(await verifyMigration(seed, ledger.db, plan, 1)).to.deep.equal([]);
	});
});

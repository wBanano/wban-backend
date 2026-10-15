import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { BigNumber, ethers } from "ethers";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import { LedgerMarker } from "../../src/storage/LedgerMarker";
import LedgerMovedToPostgresError from "../../src/errors/LedgerMovedToPostgresError";
import config from "../../src/config";
import { LedgerHarness, ledgers } from "../helpers/ledgers";

const { expect } = chai;
chai.use(chaiAsPromised);

const BAN = (amount: string) => ethers.utils.parseEther(amount);
const ALICE = "ban_1alice";
const BOB = "ban_1bob";
const CAROL = "ban_1carol";
const WALLET = "0xAbC0000000000000000000000000000000000001";
const OTHER_WALLET = "0xAbC0000000000000000000000000000000000002";
const T0 = 1_700_000_000_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function balanceOf(ledger: LedgerHarness, banAddress: string) {
	return (await ledger.storage.getUserAvailableBalance(banAddress)).toString();
}

ledgers.forEach(({ name, open }) => {
	describe(`Users deposits storage contract (${name})`, () => {
		let ledger: LedgerHarness;
		let svc: UsersDepositsService;

		beforeEach(async () => {
			ledger = await open();
			svc = new UsersDepositsService(ledger.storage);
		});

		afterEach(async () => {
			await ledger.close();
		});

		describe("Balances", () => {
			it("returns zero for an unknown account", async () => {
				expect(await balanceOf(ledger, "ban_1nobody")).to.equal("0");
			});

			it("lowercases addresses on write and read", async () => {
				await svc.storeUserDeposit("Ban_1Alice", BAN("10"), T0, "D1");
				expect(await balanceOf(ledger, "BAN_1ALICE")).to.equal(
					BAN("10").toString()
				);
			});
		});

		describe("Idempotency", () => {
			it("credits a deposit once per hash", async () => {
				await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
				await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
				expect(await balanceOf(ledger, ALICE)).to.equal(BAN("10").toString());
				expect(await ledger.storage.getDeposits(ALICE)).to.have.length(1);
				expect(
					await ledger.storage.containsUserDepositTransaction(ALICE, "D1")
				).to.equal(true);
			});

			it("credits an unwrap once per transaction hash", async () => {
				const swap = {
					blockchainWallet: WALLET,
					banWallet: ALICE,
					amount: "2.5",
					wbanBalance: "0.0",
					hash: "0xtx1",
					timestamp: T0,
				};
				await svc.storeUserSwapToBan(swap);
				await svc.storeUserSwapToBan(swap);
				expect(await balanceOf(ledger, ALICE)).to.equal(BAN("2.5").toString());
				expect(await svc.containsUserSwapToBan(swap)).to.equal(true);
			});

			it("finds a wrap by its request time", async () => {
				await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
				await svc.storeUserSwapToWBan(
					ALICE,
					WALLET,
					BAN("4"),
					T0 + 20,
					"0xreceipt1",
					"1700000000020"
				);
				expect(await svc.getSwapToWBan("Ban_1Alice", T0 + 20)).to.deep.equal({
					receipt: "0xreceipt1",
					uuid: "1700000000020",
				});
				expect(await svc.getSwapToWBan(ALICE, T0 + 21)).to.equal(undefined);
				expect(await svc.getSwapToWBan(BOB, T0 + 20)).to.equal(undefined);
			});

			it("records a withdrawal request once", async () => {
				await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
				const withdraw = async () => {
					await svc.reserveUserWithdrawal(ALICE, BAN("3"), T0 + 1);
					await svc.storeUserWithdrawal(ALICE, BAN("3"), T0 + 1, "W1");
				};
				await withdraw();
				await withdraw().catch(() => undefined);
				expect(await balanceOf(ledger, ALICE)).to.equal(BAN("7").toString());
				expect(await ledger.storage.getWithdrawals(ALICE)).to.have.length(1);
				expect(
					await ledger.storage.containsUserWithdrawalRequest(ALICE, T0 + 1)
				).to.equal(true);
			});
		});

		describe("History output", () => {
			beforeEach(async () => {
				await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
				await svc.storeUserSwapToWBan(
					ALICE,
					WALLET,
					BAN("4"),
					T0 + 1_000,
					"0xreceipt1",
					"1700000001234"
				);
				await svc.storeUserSwapToBan({
					blockchainWallet: WALLET,
					banWallet: ALICE,
					amount: "2.5",
					wbanBalance: "0.0",
					hash: "0xtx1",
					timestamp: T0 + 2_000,
				});
				await svc.reserveUserWithdrawal(ALICE, BAN("3"), T0 + 3_000);
				await svc.storeUserWithdrawal(ALICE, BAN("3"), T0 + 3_000, "W1");
			});

			it("returns deposits as strings with an explorer link", async () => {
				expect(await svc.getDeposits(ALICE)).to.deep.equal([
					{
						type: "deposit",
						hash: "D1",
						amount: "10000000000000000000",
						timestamp: String(T0),
						link: "https://creeper.banano.cc/explorer/block/D1",
					},
				]);
			});

			it("returns withdrawals as strings with an explorer link", async () => {
				expect(await svc.getWithdrawals(ALICE)).to.deep.equal([
					{
						type: "withdrawal",
						hash: "W1",
						amount: "3000000000000000000",
						timestamp: String(T0 + 3_000),
						link: "https://creeper.banano.cc/explorer/block/W1",
					},
				]);
			});

			it("returns wraps then unwraps, unwrap timestamps in microseconds", async () => {
				expect(await svc.getSwaps(WALLET, ALICE)).to.deep.equal([
					{
						type: "swap-to-wban",
						blockchainAddress: WALLET.toLowerCase(),
						receipt: "0xreceipt1",
						uuid: "1700000001234",
						amount: "4000000000000000000",
						timestamp: String(T0 + 1_000),
					},
					{
						type: "swap-to-ban",
						hash: "0xtx1",
						banAddress: ALICE,
						amount: "2500000000000000000",
						timestamp: String((T0 + 2_000) * 1_000),
						link: `${config.BlockchainBlockExplorerUrl}/tx/0xtx1`,
					},
				]);
			});

			it("keeps the balance in line with the history", async () => {
				expect(await balanceOf(ledger, ALICE)).to.equal(BAN("5.5").toString());
			});

			it("lists unwraps by blockchain address", async () => {
				expect(await svc.getSwaps(WALLET, "ban_1nobody")).to.have.length(1);
				expect(await svc.getSwaps(OTHER_WALLET, ALICE)).to.have.length(1);
			});
		});

		describe("History ordering", () => {
			it("lists newest first, equal timestamps in reverse hash order", async () => {
				await svc.storeUserDeposit(ALICE, BAN("1"), T0, "D0");
				await svc.storeUserDeposit(ALICE, BAN("1"), T0 + 5, "DA");
				await svc.storeUserDeposit(ALICE, BAN("1"), T0 + 5, "DB");
				const hashes = (await svc.getDeposits(ALICE)).map((d) => d.hash);
				expect(hashes).to.deep.equal(["DB", "DA", "D0"]);
			});

			it("returns at most 1000 entries", async function limit() {
				this.timeout(60_000);
				for (let i = 0; i < 1_001; i += 1) {
					// eslint-disable-next-line no-await-in-loop
					await svc.storeUserDeposit(ALICE, BAN("1"), T0 + i, `D${i}`);
				}
				const deposits = await svc.getDeposits(ALICE);
				expect(deposits).to.have.length(1_000);
				expect(deposits[0].hash).to.equal("D1000");
			});
		});

		describe("Claims", () => {
			it("keeps a pending claim until it is confirmed", async () => {
				expect(await svc.storePendingClaim(BOB, WALLET)).to.equal(true);
				expect(await svc.hasPendingClaim(BOB)).to.equal(true);
				expect(await svc.isClaimed(BOB)).to.equal(false);
				expect(await svc.hasClaim(BOB, WALLET)).to.equal(false);
				expect(await svc.isClaimedFromETH(WALLET)).to.equal(true);
			});

			it("confirms a pending claim", async () => {
				await svc.storePendingClaim(BOB, WALLET);
				await svc.confirmClaim(BOB);
				expect(await svc.isClaimed(BOB)).to.equal(true);
				expect(await svc.hasClaim(BOB, WALLET)).to.equal(true);
				expect(await svc.hasClaim(BOB, OTHER_WALLET)).to.equal(false);
				expect(await svc.isClaimedFromETH(WALLET)).to.equal(true);
			});

			it("forgets a pending claim once it expires", async () => {
				await svc.storePendingClaim(CAROL, OTHER_WALLET);
				await ledger.expirePendingClaims();
				expect(await svc.hasPendingClaim(CAROL)).to.equal(false);
				expect(await svc.isClaimedFromETH(OTHER_WALLET)).to.equal(false);
			});

			it("relinks confirmed claims only, all of them", async () => {
				await svc.storePendingClaim(BOB, WALLET);
				await svc.confirmClaim(BOB);
				await svc.storePendingClaim(ALICE, WALLET);
				await svc.confirmClaim(ALICE);
				await svc.storePendingClaim(CAROL, WALLET);
				expect(
					await svc.getBanAddressesForBlockchainAddress(WALLET)
				).to.have.members([ALICE, BOB]);
			});
		});

		describe("Gasless swaps and scan progress", () => {
			it("remembers a free swap", async () => {
				expect(await svc.isFreeSwapAlreadyDone(ALICE)).to.equal(false);
				await svc.storeFreeSwap("Ban_1Alice", "txn-1");
				expect(await svc.isFreeSwapAlreadyDone(ALICE)).to.equal(true);
			});

			it("reserves a free swap once", async () => {
				expect(await svc.reserveFreeSwap("Ban_1Alice")).to.equal(true);
				expect(await svc.reserveFreeSwap(ALICE)).to.equal(false);
				expect(await svc.isFreeSwapAlreadyDone(ALICE)).to.equal(true);
				await svc.storeFreeSwap(ALICE, "txn-1");
				expect(await svc.reserveFreeSwap(ALICE)).to.equal(false);
				expect(await svc.reserveFreeSwap(BOB)).to.equal(true);
			});

			it("releases a free swap reservation but never a recorded swap", async () => {
				await svc.reserveFreeSwap(ALICE);
				await svc.releaseFreeSwap(ALICE);
				expect(await svc.isFreeSwapAlreadyDone(ALICE)).to.equal(false);
				expect(await svc.reserveFreeSwap(ALICE)).to.equal(true);
				await svc.storeFreeSwap(ALICE, "txn-1");
				await svc.releaseFreeSwap(ALICE);
				expect(await svc.isFreeSwapAlreadyDone(ALICE)).to.equal(true);
			});

			it("only moves the scan progress forward", async () => {
				expect(await svc.getLastBlockchainBlockProcessed()).to.equal(
					config.BlockchainWalletPendingTransactionsStartFromBlock
				);
				await svc.setLastBlockchainBlockProcessed(100);
				await svc.setLastBlockchainBlockProcessed(50);
				expect(await svc.getLastBlockchainBlockProcessed()).to.equal(100);
			});
		});

		describe("Concurrent deposit during a swap", () => {
			it(
				name === "redis"
					? "loses the deposit (race 2 in the Redis ledger)"
					: "keeps both updates",
				async () => {
					await svc.storeUserDeposit(ALICE, BAN("10"), T0, "D1");
					const held = ledger.holdNextBalanceWrite();
					const swap = svc.storeUserSwapToWBan(
						ALICE,
						WALLET,
						BAN("4"),
						T0 + 1,
						"0xreceipt1",
						"1"
					);
					await held.reached;
					const deposit = svc.storeUserDeposit(ALICE, BAN("5"), T0 + 2, "D2");
					await Promise.race([deposit, sleep(300)]);
					held.release();
					await Promise.all([swap, deposit]);
					const expected = name === "redis" ? "6" : "11";
					expect(await balanceOf(ledger, ALICE)).to.equal(
						BAN(expected).toString()
					);
				}
			);
		});

		if (name === "redis") {
			describe("Ledger marker", () => {
				it("refuses to start or write once the ledger moved to Postgres", async () => {
					await new LedgerMarker(ledger.redis).markOnPostgres();
					await expect(ledger.storage.assertReady()).to.be.rejectedWith(
						LedgerMovedToPostgresError
					);
					await expect(
						svc.storeUserDeposit(ALICE, BigNumber.from(1), T0, "D1")
					).to.be.rejectedWith(LedgerMovedToPostgresError);
					expect(await svc.storePendingClaim(ALICE, WALLET)).to.equal(false);
				});
			});
		}
	});
});

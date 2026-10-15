import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import { UsersDepositsService } from "../src/services/UsersDepositsService";
import { Banano } from "../src/Banano";
import { BigNumber, ethers } from "ethers";
import ProcessingQueue from "../src/services/queuing/ProcessingQueue";
import config from "../src/config";

const { expect } = chai;

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Banano Service", () => {
	let svc: sinon.StubbedInstance<Banano>;
	let depositsService: sinon.StubbedInstance<UsersDepositsService>;
	let processingQueue: sinon.StubbedInstance<ProcessingQueue>;
	const seed = "012EZSFS";
	const seedIdx = 0;
	const representative = "ban_mycrazyrep";
	const hotWallet = "ban_CAFEBABE";
	const coldWallet = "ban_ILIKETHIS";

	beforeEach(async () => {
		depositsService = sinon.stubInterface<UsersDepositsService>();
		processingQueue = sinon.stubInterface<ProcessingQueue>();
		const banano = new Banano(
			hotWallet,
			coldWallet,
			seed,
			seedIdx,
			representative,
			depositsService,
			processingQueue
		);
		svc = sinon.stubObject<Banano>(banano, [
			"receiveTransaction",
			"sendBan",
			"getTotalBalance",
		]);
	});

	describe("Users Deposits", () => {
		it("Sends back deposited BAN from a wallet not claimed", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(false);
			depositsService.isClaimed.withArgs(sender).resolves(false);
			depositsService.reserveRefund
				.withArgs(hash, sender, amount)
				.resolves(true);

			svc.receiveTransaction.resolves();
			svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, Date.now(), hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and sent back
			expect(svc.sendBan).to.be.calledOnceWith(sender, amount);
			expect(depositsService.storeRefund).to.be.calledOnceWith(
				hash,
				"0xTHISROCKS"
			);
		});

		it("Skips a deposit that was already sent back", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			depositsService.hasRefund.withArgs(hash).resolves(true);
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);

			expect(
				await svc.processUserDeposit(sender, amount, Date.now(), hash)
			).to.equal(false);

			expect(depositsService.confirmClaim).to.not.have.been.called;
			expect(svc.receiveTransaction).to.have.been.calledOnceWith(hash);
			expect(depositsService.storeUserDeposit).to.not.have.been.called;
			expect(svc.sendBan).to.not.have.been.called;
		});

		it("Doesn't send back a deposit whose refund was already reserved", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(false);
			depositsService.isClaimed.withArgs(sender).resolves(false);
			depositsService.reserveRefund.resolves(false);
			svc.receiveTransaction.resolves();

			expect(
				await svc.processUserDeposit(sender, amount, Date.now(), hash)
			).to.equal(false);

			expect(svc.sendBan).to.not.have.been.called;
			expect(depositsService.storeRefund).to.not.have.been.called;
			expect(depositsService.storeUserDeposit).to.not.have.been.called;
		});

		it("Keeps the refund reserved when the send returns no block hash", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(false);
			depositsService.isClaimed.withArgs(sender).resolves(false);
			depositsService.reserveRefund.resolves(true);
			svc.receiveTransaction.resolves();
			svc.sendBan.resolves("");

			await expect(
				svc.processUserDeposit(sender, amount, Date.now(), hash)
			).to.be.rejectedWith("the refund stays reserved");
			expect(depositsService.storeRefund).to.not.have.been.called;
		});

		it("Sends back BAN deposits with more than two decimals", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1.466");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(false);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.reserveRefund
				.withArgs(hash, sender, amount)
				.resolves(true);

			svc.receiveTransaction.resolves();
			svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, Date.now(), hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and sent back
			expect(svc.sendBan).to.be.calledOnceWith(sender, amount);
			expect(depositsService.storeRefund).to.be.calledOnceWith(
				hash,
				"0xTHISROCKS"
			);
			// and have no deposit stored
			expect(depositsService.storeUserDeposit).to.not.have.been.called;
		});

		it("Fails if there is a redlock error", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			const timestamp = Date.now();
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, timestamp, hash)
				.throws(new Error("Exceeded 10 attempts to lock the resource"));

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(ethers.utils.parseEther("1"))
				.withArgs(coldWallet)
				.resolves(ethers.utils.parseEther("1"));

			// make a deposit expected to fail
			expect(
				svc.processUserDeposit(sender, amount, timestamp, hash)
			).to.be.rejectedWith(
				new Error("Exceeded 10 attempts to lock the resource")
			);
		});

		it("Registers user deposit from a pending claimed wallet", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			const timestamp = Date.now();
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, timestamp, hash)
				.resolves();

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(ethers.utils.parseEther("1"))
				.withArgs(coldWallet)
				.resolves(ethers.utils.parseEther("1"));

			// make a deposit
			await svc.processUserDeposit(sender, amount, timestamp, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				timestamp,
				hash
			);
		});
	});

	describe("Missed deposits", () => {
		it("receives own-wallet blocks, one dust block per run, and keeps queueing deposits", async () => {
			svc.receiveTransaction.resolves();
			const oneBan = `1${"0".repeat(29)}`;

			await svc.queuePendingTransactions({
				DUST: { amount: "5", source: "ban_dust" },
				MORE_DUST: { amount: "6", source: "ban_dust" },
				SELF: { amount: oneBan, source: hotWallet },
				USER: { amount: oneBan, source: "ban_user" },
			});

			expect(svc.receiveTransaction).to.have.been.calledTwice;
			expect(svc.receiveTransaction).to.have.been.calledWith("DUST");
			expect(svc.receiveTransaction).to.have.been.calledWith("SELF");
			expect(processingQueue.addBananoUserDeposit).to.have.been.calledOnce;
			expect(processingQueue.addBananoUserDeposit.firstCall.args[0]).to.include(
				{ sender: "ban_user", amount: "1.0", hash: "USER" }
			);
		});
	});

	describe("Users Deposits hot/cold wallets", () => {
		let dataset = [
			{
				hot: config.BananoUsersDepositsHotWalletMinimum,
				deposit: "10",
				expected: "8.0",
			},
			{ hot: "5", deposit: "12", expected: "5.6" },
			{ hot: "0", deposit: "11", expected: "0.8" },
			{ hot: "20", deposit: "10", expected: "8.0" },
			{
				hot: config.BananoUsersDepositsHotWalletMinimum,
				deposit: "4.12",
				expected: "3.2",
			},
		];

		dataset.forEach(({ hot, deposit, expected }) => {
			it(`Send ${expected} BAN to cold wallet when hot wallet has ${hot} BAN and user made a deposit of ${deposit} BAN`, async () => {
				const sender = "ban_sender";
				const amount: BigNumber = ethers.utils.parseEther(deposit);
				const timestamp = Date.now();
				const hash = "0xCAFEBABE";
				depositsService.hasPendingClaim.withArgs(sender).resolves(true);
				depositsService.confirmClaim.withArgs(sender).resolves(true);
				depositsService.isClaimed.withArgs(sender).resolves(true);
				depositsService.storeUserDeposit
					.withArgs(sender, amount, timestamp, hash)
					.resolves();

				svc.receiveTransaction.resolves();
				svc.getTotalBalance
					.withArgs(hotWallet)
					.resolves(ethers.utils.parseEther(hot).add(amount));
				svc.sendBan.resolves("0xTHISROCKS");

				// make a deposit
				await svc.processUserDeposit(sender, amount, timestamp, hash);

				// expect for it to be received
				expect(svc.receiveTransaction).to.be.calledOnce;
				// and stored
				expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
					sender,
					amount,
					timestamp,
					hash
				);
				// and BAN to be sent to cold wallet
				expect(svc.sendBan).to.be.calledOnceWith(
					coldWallet,
					ethers.utils.parseEther(expected)
				);
			});
		});

		it("Don't send BAN to cold wallet if there is not enough BAN in hot wallet", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("4");
			const timestamp = Date.now();
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, timestamp, hash)
				.resolves();

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(
					ethers.utils
						.parseEther(config.BananoUsersDepositsHotWalletMinimum)
						.sub(amount.add(ethers.utils.parseEther("1")))
				);
			// svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, timestamp, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				timestamp,
				hash
			);
			// and no BAN to be sent to cold wallet
			expect(svc.sendBan).to.not.have.been.called;
		});

		it("Don't send BAN to cold wallet if there is 0 BAN to send", async () => {
			const hot = config.BananoUsersDepositsHotWalletMinimum;
			const deposit = "0.01";
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther(deposit);
			const timestamp = Date.now();
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, timestamp, hash)
				.resolves();

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(ethers.utils.parseEther(hot).add(amount));
			svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, timestamp, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				timestamp,
				hash
			);
			// and no BAN to be sent to cold wallet
			expect(svc.sendBan).to.not.have.been.called;
		});
	});
});

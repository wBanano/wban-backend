import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import { Banano } from "../../src/Banano";
import { BigNumber, ethers } from "ethers";
import ProcessingQueue from "../../src/services/queuing/ProcessingQueue";
import config from "../../src/config";

const { expect } = chai;

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Banano Service", () => {
	let svc: sinon.StubbedInstance<Banano> = null;
	let depositsService: sinon.StubbedInstance<UsersDepositsService> = null;
	let processingQueue: sinon.StubbedInstance<ProcessingQueue> = null;
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

			svc.receiveTransaction.resolves();
			svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and sent back
			expect(svc.sendBan).to.be.calledOnceWith(sender, amount);
		});

		it("Registers user deposit from a pending claimed wallet", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("1");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, hash)
				.resolves();

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(ethers.utils.parseEther("1"))
				.withArgs(coldWallet)
				.resolves(ethers.utils.parseEther("1"));

			// make a deposit
			await svc.processUserDeposit(sender, amount, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				hash
			);
		});
	});

	describe("Users Deposits hot/cold wallets", () => {
		it("Sends BAN to cold wallet if there is enough BAN in hot wallet and threshold is breached", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("10");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, hash)
				.resolves();

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(
					ethers.utils
						.parseEther(config.BananoUsersDepositsHotWalletMinimum)
						.add(amount)
				);
			svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				hash
			);
			// and BAN to be sent to cold wallet
			expect(svc.sendBan).to.be.calledOnceWith(
				coldWallet,
				ethers.utils.parseEther("8.0")
			);
		});

		it("Sends BAN to cold wallet only the above threshold when cold wallet has less than min deposits", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("12");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, hash)
				.resolves();

			svc.receiveTransaction.resolves();
			svc.getTotalBalance
				.withArgs(hotWallet)
				.resolves(ethers.utils.parseEther("5").add(amount));
			svc.sendBan.resolves("0xTHISROCKS");

			// make a deposit
			await svc.processUserDeposit(sender, amount, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				hash
			);
			// and BAN to be sent to cold wallet
			expect(svc.sendBan).to.be.calledOnceWith(
				coldWallet,
				ethers.utils.parseEther("5.6")
			);
		});

		it("Don't send BAN to cold wallet if there is not enough BAN in hot wallet", async () => {
			const sender = "ban_sender";
			const amount: BigNumber = ethers.utils.parseEther("4");
			const hash = "0xCAFEBABE";
			depositsService.hasPendingClaim.withArgs(sender).resolves(true);
			depositsService.confirmClaim.withArgs(sender).resolves(true);
			depositsService.isClaimed.withArgs(sender).resolves(true);
			depositsService.storeUserDeposit
				.withArgs(sender, amount, hash)
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
			await svc.processUserDeposit(sender, amount, hash);

			// expect for it to be received
			expect(svc.receiveTransaction).to.be.calledOnce;
			// and stored
			expect(depositsService.storeUserDeposit).to.be.calledOnceWith(
				sender,
				amount,
				hash
			);
			// and BAN to be sent to cold wallet
			expect(svc.sendBan).to.not.have.been.called;
		});
	});
});

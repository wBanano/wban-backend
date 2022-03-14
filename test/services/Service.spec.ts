import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import { Service } from "../../src/services/Service";
import { ClaimResponse } from "../../src/models/responses/ClaimResponse";
import { BigNumber, ethers } from "ethers";
import { Blockchain } from "../../src/Blockchain";
import InvalidOwner from "../../src/errors/InvalidOwner";
import InvalidSignatureError from "../../src/errors/InvalidSignatureError";
import { Banano } from "../../src/Banano";
import ProcessingQueue from "../../src/services/queuing/ProcessingQueue";
import BlockchainScanQueue from "../../src/services/queuing/BlockchainScanQueue";
import BananoUserWithdrawal from "../../src/models/operations/BananoUserWithdrawal";
import config from "../../src/config";
import KirbyBananoWalletsBlacklist from "../../src/services/KirbyBananoWalletsBlacklist";
import { BananoWalletsBlacklist } from "../../src/services/BananoWalletsBlacklist";
import { on } from "events";

const { expect } = chai;
chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Main Service", () => {
	let svc: Service;
	let depositsService: sinon.StubbedInstance<UsersDepositsService>;
	let processingQueue: sinon.StubbedInstance<ProcessingQueue>;
	let blockchainScanQueue: sinon.StubbedInstance<BlockchainScanQueue>;
	let blockchain: sinon.StubbedInstance<Blockchain>;
	let banano: sinon.StubbedInstance<Banano>;
	let bananoWalletsBlacklist: sinon.StubbedInstance<BananoWalletsBlacklist>;

	beforeEach(async () => {
		depositsService = sinon.stubInterface<UsersDepositsService>();
		processingQueue = sinon.stubInterface<ProcessingQueue>();
		blockchainScanQueue = sinon.stubInterface<BlockchainScanQueue>();
		blockchain = sinon.stubInterface<Blockchain>();
		banano = sinon.stubInterface<Banano>();
		bananoWalletsBlacklist = sinon.stubInterface<BananoWalletsBlacklist>();
		svc = new Service(
			depositsService,
			processingQueue,
			blockchainScanQueue,
			bananoWalletsBlacklist
		);
		svc.blockchain = blockchain;
		svc.banano = banano;
	});

	it("Checks properly signatures", async () => {
		const amount = "29.0";
		const from =
			"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
		const blockchainWallet = "0x69fd25b60da76afd10d8fc7306f10f2934fc4829";
		const signature =
			"0x8b828450dbc98d25c13443f91338863bb319266d3d9e92fdf5e1eb4d9b241b85704dcabe560382790435510b33b2990057d3325fb992e9f29b5c9ffede6b5e121c";
		const badSignature =
			"0x8b828450dbc98d25c13443f91338863bb319266d3d9e92fdf5e1eb4d9b241b85704dcabe560382790435510b33b2990057d3325fb992e9f29b5c9ffede6b5e121b";

		expect(
			svc.checkSignature(
				blockchainWallet,
				signature,
				`Swap ${amount} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		).to.be.true;

		expect(
			svc.checkSignature(
				"0x59fd25b60da76afd10d8fc7306f10f2934fc4828",
				signature,
				`Swap ${amount} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		).to.be.false;

		await expect(
			svc.processSwapToWBAN({
				from,
				amount: 10,
				blockchainWallet,
				timestamp: Date.now(),
				signature: badSignature,
			})
		).to.eventually.be.rejectedWith(InvalidSignatureError);
	});

	describe("Claims for BAN wallet", () => {
		it("Checks that a BAN wallet can be claimed multiple times by the same Blockchain user", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
			const blockchainWallet = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const signature =
				"0x521c2e1ae5e12da983b4a30bba29a6af4a24317c9378b124f5f5c2b69d96e945082322939fbdd1d8c351c218485934bbd6c997ae6d4066cbf81a24321cf18f551c";

			bananoWalletsBlacklist.isBlacklisted.resolves(undefined);
			depositsService.isClaimed
				.onFirstCall()
				.resolves(false)
				.onSecondCall()
				.resolves(true);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet)
				.onFirstCall()
				.resolves(false)
				.onSecondCall()
				.resolves(true)
				.onThirdCall()
				.resolves(true);
			depositsService.hasPendingClaim
				.withArgs(banWallet)
				.onFirstCall()
				.resolves(false)
				.onSecondCall()
				.resolves(true);
			depositsService.storePendingClaim
				.withArgs(banWallet, blockchainWallet)
				.returns(Promise.resolve(true));

			expect(await svc.claimAvailable(banWallet, blockchainWallet)).to.equal(
				false
			);
			expect(await svc.claim(banWallet, blockchainWallet, signature)).to.equal(
				ClaimResponse.Ok
			);
			expect(await svc.claimAvailable(banWallet, blockchainWallet)).to.equal(
				true
			);
			expect(await svc.claim(banWallet, blockchainWallet, signature)).to.equal(
				ClaimResponse.AlreadyDone
			);
			expect(depositsService.storePendingClaim).to.have.been.calledOnce;
		});

		it("Checks that a BAN wallet can't be claimed by two different users", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";

			const blockchainWallet1 = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const signature1 =
				"0x521c2e1ae5e12da983b4a30bba29a6af4a24317c9378b124f5f5c2b69d96e945082322939fbdd1d8c351c218485934bbd6c997ae6d4066cbf81a24321cf18f551c";

			const blockchainWallet2 = "0x69FD25B60Da76Afd10D8Fc7306f10f2934fC4829";
			const signature2 =
				"0x6e0306e2daf7a3c9581b3d57b79eb34aad1b713a6d4426d38e0681d7a54d6aab534a36d44cac890e17d45efb173768817d4cfcdd04259d7137039a4fb90264141c";

			bananoWalletsBlacklist.isBlacklisted.resolves(undefined);
			depositsService.isClaimed
				.onFirstCall()
				.resolves(false)
				.onSecondCall()
				.resolves(false);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet1)
				.resolves(false)
				.withArgs(banWallet, blockchainWallet2)
				.resolves(false);
			depositsService.hasPendingClaim
				.withArgs(banWallet)
				.onFirstCall()
				.resolves(false)
				.onSecondCall()
				.resolves(true);
			depositsService.storePendingClaim
				.withArgs(banWallet, blockchainWallet1)
				.returns(Promise.resolve(true));

			expect(
				await svc.claim(banWallet, blockchainWallet1, signature1)
			).to.equal(ClaimResponse.Ok);

			expect(
				await svc.claim(banWallet, blockchainWallet2, signature2)
			).to.equal(ClaimResponse.InvalidOwner);

			expect(depositsService.storePendingClaim).to.have.been.calledOnce;
		});

		it("Checks that a BAN wallet already claimed can't be claimed by another user", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";

			const blockchainWallet1 = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const signature1 =
				"0x521c2e1ae5e12da983b4a30bba29a6af4a24317c9378b124f5f5c2b69d96e945082322939fbdd1d8c351c218485934bbd6c997ae6d4066cbf81a24321cf18f551c";

			const blockchainWallet2 = "0x69FD25B60Da76Afd10D8Fc7306f10f2934fC4829";
			const signature2 =
				"0x6e0306e2daf7a3c9581b3d57b79eb34aad1b713a6d4426d38e0681d7a54d6aab534a36d44cac890e17d45efb173768817d4cfcdd04259d7137039a4fb90264141c";

			bananoWalletsBlacklist.isBlacklisted.resolves(undefined);
			depositsService.isClaimed.resolves(true);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet1)
				.resolves(true)
				.withArgs(banWallet, blockchainWallet2)
				.resolves(false);
			depositsService.hasPendingClaim
				.withArgs(banWallet)
				//.onFirstCall()
				.resolves(true);
			depositsService.storePendingClaim
				.withArgs(banWallet, blockchainWallet1)
				.returns(Promise.resolve(true));

			expect(
				await svc.claim(banWallet, blockchainWallet2, signature2)
			).to.equal(ClaimResponse.InvalidOwner);

			expect(depositsService.storePendingClaim).to.not.have.been.called;
		});

		it("Checks that a blacklisted BAN wallet can't be claimed", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
			const blockchainWallet = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const signature =
				"0x521c2e1ae5e12da983b4a30bba29a6af4a24317c9378b124f5f5c2b69d96e945082322939fbdd1d8c351c218485934bbd6c997ae6d4066cbf81a24321cf18f551c";

			bananoWalletsBlacklist.isBlacklisted
				.withArgs(banWallet)
				.resolves({ address: banWallet, alias: "CoinEx", type: "" });

			expect(await svc.claim(banWallet, blockchainWallet, signature)).to.equal(
				ClaimResponse.Blacklisted
			);
			expect(depositsService.storePendingClaim).to.not.have.been.called;
		});
	});

	describe("Withdrawals", () => {
		it("Checks if a negative withdrawal amount is rejected", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
			const blockchainWallet = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const withdrawal: BananoUserWithdrawal = {
				banWallet,
				amount: "-5",
				blockchainWallet,
				signature:
					"0xc7f21062ef2c672e8cc77cecfdf532f39bcf6791e7f41266491fe649bedeaec9443e963400882d6dc46c8e10c033528a7bc5a517e136296d01be339baf6e9efb1b",
				timestamp: Date.now(),
				attempt: 0,
			};
			depositsService.containsUserWithdrawalRequest
				.withArgs(withdrawal)
				.onFirstCall()
				.resolves(false);
			depositsService.isClaimed.withArgs(banWallet).resolves(true);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet)
				.resolves(true);
			depositsService.getUserAvailableBalance
				.withArgs(banWallet)
				.resolves(ethers.utils.parseEther("200"));
			banano.getBalance
				.withArgs(config.BananoUsersDepositsHotWallet)
				.resolves(ethers.utils.parseEther("100"));
			// make the withdrawal...
			await expect(
				svc.processWithdrawBAN(withdrawal)
			).to.eventually.be.rejectedWith("Can't withdraw negative amounts of BAN");
			// ... and that no withdrawal was processed
			expect(banano.sendBan).to.have.not.been.called;
			expect(depositsService.storeUserWithdrawal).to.have.not.been.called;
		});

		it("Checks if a big withdrawal is put in pending withdrawals", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
			const blockchainWallet = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const withdrawal: BananoUserWithdrawal = {
				banWallet,
				amount: "150",
				blockchainWallet,
				signature:
					"0xc7f21062ef2c672e8cc77cecfdf532f39bcf6791e7f41266491fe649bedeaec9443e963400882d6dc46c8e10c033528a7bc5a517e136296d01be339baf6e9efb1b",
				timestamp: Date.now(),
				attempt: 0,
			};
			depositsService.containsUserWithdrawalRequest
				.withArgs(withdrawal)
				.onFirstCall()
				.resolves(false);
			depositsService.isClaimed.withArgs(banWallet).resolves(true);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet)
				.resolves(true);
			depositsService.getUserAvailableBalance
				.withArgs(banWallet)
				.resolves(ethers.utils.parseEther("200"));
			banano.getBalance
				.withArgs(config.BananoUsersDepositsHotWallet)
				.resolves(ethers.utils.parseEther("100"));
			// make the withdrawal...
			await svc.processWithdrawBAN(withdrawal);
			// ... expect it to be added to the pending withdrawals queue
			expect(processingQueue.addBananoUserPendingWithdrawal).to.have.been
				.calledOnce;
			// ... and that no withdrawal was processed
			expect(banano.sendBan).to.have.not.been.called;
			expect(depositsService.storeUserWithdrawal).to.have.not.been.called;
		});
	});

	describe("Swaps BAN->wBAN", () => {
		it("Checks that a swap can't be done with negative BAN amount", async () => {
			const availableBalance = ethers.utils.parseEther("10");

			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";

			const blockchainWallet = "0xec410e9f2756c30be4682a7e29918082adc12b55";
			const signature =
				"0x2bd2af61c6fb8672751ee7e22e9c477a5bd274ce56b7ebc8cb596d1a6abbf4c72bc3dd5c2015bb27f2d71b6fcfdae95cd9c22ba67108b0940ca166284f16d6891c";

			depositsService.getUserAvailableBalance
				.withArgs(banWallet)
				.resolves(availableBalance);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet)
				.resolves(true);

			await expect(
				svc.processSwapToWBAN({
					from: banWallet,
					amount: -1,
					blockchainWallet: blockchainWallet,
					timestamp: Date.now(),
					signature: signature,
				})
			).to.eventually.be.rejectedWith("Can't swap negative amounts of BAN");
			expect(blockchain.createMintReceipt).to.not.have.been.called;
		});
	});

	describe("Idempotence", () => {
		it("Checks if a user withdrawal request is not processed twice", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
			const blockchainWallet = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const withdrawal: BananoUserWithdrawal = {
				banWallet,
				amount: "150",
				blockchainWallet,
				signature:
					"0xc7f21062ef2c672e8cc77cecfdf532f39bcf6791e7f41266491fe649bedeaec9443e963400882d6dc46c8e10c033528a7bc5a517e136296d01be339baf6e9efb1b",
				timestamp: Date.now(),
				attempt: 0,
			};
			depositsService.containsUserWithdrawalRequest
				.withArgs(withdrawal)
				// accept to ingest the transaction the first time
				.onFirstCall()
				.resolves(false)
				// reject it the second time
				.onSecondCall()
				.resolves(true);
			depositsService.isClaimed.withArgs(banWallet).resolves(true);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet)
				.resolves(true);
			depositsService.getUserAvailableBalance
				.withArgs(banWallet)
				.resolves(ethers.utils.parseEther("200"));
			banano.getBalance
				.withArgs(config.BananoUsersDepositsHotWallet)
				.resolves(ethers.utils.parseEther("300"));
			banano.sendBan.resolves(
				"6E3EB2D376517C188D8E621A8326E73D3C36295B84634F0C16354C4DE6ABE0F3"
			);
			// call the service twice...
			await svc.processWithdrawBAN(withdrawal);
			await expect(
				svc.processWithdrawBAN(withdrawal)
			).to.eventually.be.rejectedWith(
				"Can't withdraw BAN as the transaction was already processed"
			);
			// ... and expect only one withdrawal
			expect(banano.sendBan).to.have.been.calledOnce;
			// ... to make sure the transaction is not stored twice but once!
			expect(depositsService.storeUserWithdrawal).to.have.been.calledOnce;
		});
	});

	describe("Safeguards against impersonating", () => {
		it("Checks that a swap can only be done from a valid claim", async () => {
			const amount = ethers.utils.parseEther("10");

			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";

			const blockchainWallet1 = "0xec410e9f2756c30be4682a7e29918082adc12b55";
			const signature1 =
				"0x3931a99b23a5156661949e6f25ab12bb4f827dae7e17e7a54da28b5de517666130b4f639b99288118a1d5736a55a6b6bca833ab09fc1a2ca7164e2fe15deb1331b";

			const blockchainWallet2 = "0x69FD25B60Da76Afd10D8Fc7306f10f2934fC4829";
			const signature2 =
				"0xf9960fcdc11388a841ab29a53e655fc1f5b117c77a00b4145eaafda24898ac3d20887765b5cd415b7a6bef3f665d5ce0478ad569888963eb889fd0b07ec85c7b1c";

			depositsService.getUserAvailableBalance
				.withArgs(banWallet)
				.resolves(amount);
			depositsService.hasClaim
				.withArgs(banWallet, blockchainWallet1)
				.resolves(true)
				.withArgs(banWallet, blockchainWallet2)
				.resolves(false);
			blockchain.createMintReceipt
				.withArgs(blockchainWallet1, amount)
				.resolves({
					receipt: "0xCAFEBABE",
					uuid: "123",
					wbanBalance: BigNumber.from(0),
				})
				.withArgs(blockchainWallet2, amount)
				.resolves({
					receipt: "0xCAFEBABE",
					uuid: "123",
					wbanBalance: BigNumber.from(0),
				});

			// legit user should be able to swap
			const { receipt, uuid, wbanBalance } = await svc.processSwapToWBAN({
				from: banWallet,
				amount: 10,
				blockchainWallet: blockchainWallet1,
				timestamp: Date.now(),
				signature: signature1,
			});
			expect(receipt).to.equal("0xCAFEBABE");
			expect(ethers.utils.formatEther(wbanBalance)).to.equal("0.0");

			// hacker trying to swap funds from a wallet he doesn't own should be able to do it
			await expect(
				svc.processSwapToWBAN({
					from: banWallet,
					amount: 10,
					blockchainWallet: blockchainWallet2,
					timestamp: Date.now(),
					signature: signature2,
				})
			).to.eventually.be.rejectedWith(InvalidOwner);
		});
	});
});

import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import config from "../../src/config";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import { Service } from "../../src/services/Service";
import { ClaimResponse } from "../../src/models/responses/ClaimResponse";
import { BigNumber, ethers } from "ethers";
import { BSC } from "../../src/BSC";
import InvalidOwner from "../../src/errors/InvalidOwner";
import InvalidSignatureError from "../../src/errors/InvalidSignatureError";

const { expect } = chai;
chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Main Service", () => {
	let svc: Service = null;
	let depositsService: any = null;
	let bsc: any = null;

	beforeEach(async () => {
		depositsService = sinon.stubInterface<UsersDepositsService>();
		bsc = sinon.stubInterface<BSC>();
		svc = new Service(depositsService);
		svc.bsc = bsc;
	});

	it("Checks properly signatures", async () => {
		const amount = "29.0";
		const from =
			"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
		const bscWallet = "0x69fd25b60da76afd10d8fc7306f10f2934fc4829";
		const signature =
			"0x8b828450dbc98d25c13443f91338863bb319266d3d9e92fdf5e1eb4d9b241b85704dcabe560382790435510b33b2990057d3325fb992e9f29b5c9ffede6b5e121c";
		const badSignature =
			"0x8b828450dbc98d25c13443f91338863bb319266d3d9e92fdf5e1eb4d9b241b85704dcabe560382790435510b33b2990057d3325fb992e9f29b5c9ffede6b5e121b";

		expect(
			svc.checkSignature(
				bscWallet,
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
			svc.swap(from, 10, bscWallet, badSignature)
		).to.eventually.be.rejectedWith(InvalidSignatureError);
	});

	describe("Claims for BAN wallet", () => {
		it("Checks that a BAN wallet can't be claimed multiple times by the same BSC user", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
			const bscWallet = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const signature =
				"0x521c2e1ae5e12da983b4a30bba29a6af4a24317c9378b124f5f5c2b69d96e945082322939fbdd1d8c351c218485934bbd6c997ae6d4066cbf81a24321cf18f551c";
			depositsService.hasClaim
				.withArgs(banWallet, bscWallet)
				.onFirstCall()
				.returns(Promise.resolve(false))
				.onSecondCall()
				.returns(Promise.resolve(true));
			depositsService.hasPendingClaim
				.withArgs(banWallet)
				.onFirstCall()
				.returns(Promise.resolve(true))
				.onSecondCall()
				.returns(Promise.resolve(false));
			depositsService.storePendingClaim
				.withArgs(banWallet, bscWallet)
				.returns(Promise.resolve(true));
			expect(await svc.claim(banWallet, bscWallet, signature)).to.equal(
				ClaimResponse.Ok
			);
			expect(await svc.claim(banWallet, bscWallet, signature)).to.equal(
				ClaimResponse.AlreadyDone
			);
			expect(depositsService.storePendingClaim).to.have.been.calledOnce;
		});

		it("Checks that a BAN wallet can't be claimed by two different users", async () => {
			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";

			const bscWallet1 = "0xec410E9F2756C30bE4682a7E29918082Adc12B55";
			const signature1 =
				"0x521c2e1ae5e12da983b4a30bba29a6af4a24317c9378b124f5f5c2b69d96e945082322939fbdd1d8c351c218485934bbd6c997ae6d4066cbf81a24321cf18f551c";

			const bscWallet2 = "0x69FD25B60Da76Afd10D8Fc7306f10f2934fC4829";
			const signature2 =
				"0x6e0306e2daf7a3c9581b3d57b79eb34aad1b713a6d4426d38e0681d7a54d6aab534a36d44cac890e17d45efb173768817d4cfcdd04259d7137039a4fb90264141c";

			depositsService.hasClaim
				.withArgs(banWallet, bscWallet1)
				.returns(Promise.resolve(false))
				.withArgs(banWallet, bscWallet2)
				.returns(Promise.resolve(false));
			depositsService.hasPendingClaim
				.withArgs(banWallet)
				.onFirstCall()
				.returns(Promise.resolve(true))
				.onSecondCall()
				.returns(Promise.resolve(false));
			depositsService.storePendingClaim
				.withArgs(banWallet, bscWallet1)
				.returns(Promise.resolve(true));

			expect(await svc.claim(banWallet, bscWallet1, signature1)).to.equal(
				ClaimResponse.Ok
			);

			expect(await svc.claim(banWallet, bscWallet2, signature2)).to.equal(
				ClaimResponse.InvalidOwner
			);

			expect(depositsService.storePendingClaim).to.have.been.calledOnce;
		});
	});

	describe("Safeguards against impersonating", () => {
		it("Checks that a swap can only be done from a valid claim", async () => {
			const amount = ethers.utils.parseEther("10");

			const banWallet =
				"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";

			const bscWallet1 = "0xec410e9f2756c30be4682a7e29918082adc12b55";
			const signature1 =
				"0x3931a99b23a5156661949e6f25ab12bb4f827dae7e17e7a54da28b5de517666130b4f639b99288118a1d5736a55a6b6bca833ab09fc1a2ca7164e2fe15deb1331b";

			const bscWallet2 = "0x69FD25B60Da76Afd10D8Fc7306f10f2934fC4829";
			const signature2 =
				"0xf9960fcdc11388a841ab29a53e655fc1f5b117c77a00b4145eaafda24898ac3d20887765b5cd415b7a6bef3f665d5ce0478ad569888963eb889fd0b07ec85c7b1c";

			depositsService.getUserAvailableBalance
				.withArgs(banWallet)
				.returns(Promise.resolve(amount));
			depositsService.hasClaim
				.withArgs(banWallet, bscWallet1)
				.returns(Promise.resolve(true))
				.withArgs(banWallet, bscWallet2)
				.returns(Promise.resolve(false));
			bsc.mintTo
				.withArgs(bscWallet1, amount)
				.returns(Promise.resolve("0xCAFEBABE"))
				.withArgs(bscWallet2, amount)
				.returns(Promise.resolve("0xCAFEBABE"));

			// legit user should be able to swap
			expect(await svc.swap(banWallet, 10, bscWallet1, signature1)).to.equal(
				"0xCAFEBABE"
			);

			// hacker trying to swap funds from a wallet he doesn't own should be able to do it
			// expect(await svc.swap(banWallet, 10, bscWallet2, signature2));
			await expect(
				svc.swap(banWallet, 10, bscWallet2, signature2)
			).to.eventually.be.rejectedWith(InvalidOwner);
		});
	});
});

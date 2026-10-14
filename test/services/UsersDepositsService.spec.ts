import chai from "chai";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import chaiAsPromised from "chai-as-promised";
import { BigNumber } from "ethers";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import { UsersDepositsStorage } from "../../src/storage/UsersDepositsStorage";

const { expect } = chai;
chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Users Deposits Service", () => {
	let svc: UsersDepositsService;
	let storage: any;

	beforeEach(async () => {
		storage = sinon.stubInterface<UsersDepositsStorage>();
		svc = new UsersDepositsService(storage);
	});

	it("Checks if user balance is returned as-is from the UserDepositsStorage implementation", async () => {
		const userAddress = "0xCAFEBABE";
		const expectedBalance = 123;
		storage.getUserAvailableBalance.returns(Promise.resolve(expectedBalance));
		expect(await svc.getUserAvailableBalance(userAddress)).to.equal(
			expectedBalance
		);
	});

	it("Checks if a user deposit transaction is not ingested twice in storage", async () => {
		const address = "0xCAFEBABE";
		const amount = BigNumber.from(123);
		const hash = "<the-hash>";
		const timestamp = Date.now();
		storage.containsUserDepositTransaction
			// accept to ingest the transaction the first time
			.onFirstCall()
			.resolves(true)
			// reject it the second time
			.onSecondCall()
			.resolves(false);
		storage.containsUserDepositTransaction;
		storage.storeUserDeposit.resolves();
		// call the service twice...
		await svc.storeUserDeposit(address, amount, timestamp, hash);
		await svc.storeUserDeposit(address, amount, timestamp, hash);
		expect(
			storage.containsUserDepositTransaction
		).to.have.been.calledTwice.and.calledWith(address, hash);
		// ... to make sure the transaction is not store twice but once!
		expect(storage.storeUserDeposit).to.have.been.calledOnce;
	});

	it("Fails when the storage can't record a deposit", async () => {
		storage.containsUserDepositTransaction.resolves(false);
		storage.storeUserDeposit.rejects(new Error("write failed"));
		await expect(
			svc.storeUserDeposit("ban_1a", BigNumber.from(1), Date.now(), "H")
		).to.be.rejectedWith("write failed");
	});

	it("Fails when the storage can't record a withdrawal", async () => {
		storage.storeUserWithdrawal.rejects(new Error("write failed"));
		await expect(
			svc.storeUserWithdrawal("ban_1a", BigNumber.from(1), Date.now(), "H")
		).to.be.rejectedWith("write failed");
	});
});

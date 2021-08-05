import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import { Blockchain } from "../src/Blockchain";
import { UsersDepositsService } from "../src/services/UsersDepositsService";
import ProcessingQueue from "../src/services/queuing/ProcessingQueue";

const { expect } = chai;

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Blockchain Service", () => {
	let svc: sinon.StubbedInstance<Blockchain> = null;

	beforeEach(async () => {
		const usersDepositsService = sinon.stubInterface<UsersDepositsService>();
		const blockchainScanQueue = sinon.stubInterface<ProcessingQueue>();
		const blockchain = new Blockchain(
			usersDepositsService,
			blockchainScanQueue
		);
		svc = sinon.stubObject<Blockchain>(blockchain, ["processBlocksSlice"]);
	});

	describe("Blockchain block ranges in chunks", async () => {
		it("Single slice for small range", async () => {
			await svc.processBlocks(1535, 1538);
			expect(svc.processBlocksSlice).to.be.calledOnce;
			expect(svc.processBlocksSlice).to.be.calledWithExactly(1535, 1538);
		});

		it("Single slice for complete chunk", async () => {
			await svc.processBlocks(1535, 2534);
			expect(svc.processBlocksSlice).to.be.calledOnce;
			expect(svc.processBlocksSlice).to.be.calledWithExactly(1535, 2534);
		});

		it("Two slices for a bigger range", async () => {
			await svc.processBlocks(1535, 2538);
			expect(svc.processBlocksSlice).to.be.calledTwice;
			expect(svc.processBlocksSlice).to.be.calledWithExactly(1535, 2534);
			expect(svc.processBlocksSlice).to.be.calledWithExactly(2535, 2538);
		});

		it("Five slices for a really big range", async () => {
			await svc.processBlocks(1535, 6512);
			expect(svc.processBlocksSlice).callCount(5);
			expect(svc.processBlocksSlice).to.be.calledWithExactly(1535, 2534);
			expect(svc.processBlocksSlice).to.be.calledWithExactly(2535, 3534);
			expect(svc.processBlocksSlice).to.be.calledWithExactly(3535, 4534);
			expect(svc.processBlocksSlice).to.be.calledWithExactly(4535, 5534);
			expect(svc.processBlocksSlice).to.be.calledWithExactly(5535, 6512);
		});
	});
});

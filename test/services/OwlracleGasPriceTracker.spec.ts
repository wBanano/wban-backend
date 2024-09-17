import chai from "chai";
import sinonChai from "sinon-chai";
import { BigNumber } from "ethers";
import { formatUnits, parseUnits } from "ethers/lib/utils";
import { BlockchainGasPriceTracker } from "../../src/services/BlockchainGasPriceTracker";
import { OwlracleGasPriceTracker } from "../../src/services/OwlracleGasPriceTracker";
import config from "../../src/config";

const { expect } = chai;
chai.use(sinonChai);

describe("Owlracle gas price tracker", () => {
	let svc: BlockchainGasPriceTracker;
	let storage: any;

	beforeEach(async () => {
		svc = new OwlracleGasPriceTracker();
	});

	it("Checks Arbitrum gas price", async () => {
		config.BlockchainNetworkChainId = 42161;
		const gasPrice: BigNumber = await svc.getGasPriceTrackerData();
		expect(gasPrice.toNumber())
			.to.be.gte(parseUnits("0.01", "gwei").toNumber())
			.lte(parseUnits("1", "gwei").toNumber());
		expect(gasPrice.toString())
			.to.equal("10000000");
	});
});

import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import axios from "axios";
import sinon from "sinon";
import { CoinGeckoPricer } from "../../src/prices/CoinGeckoPricer";

const { expect } = chai;
chai.use(chaiAsPromised);

const response = {
	data: {
		banano: { usd: 0.0005 },
		binancecoin: { usd: 730 },
		ethereum: { usd: 2400 },
		"polygon-ecosystem-token": { usd: 0.1 },
		"sonic-3": { usd: 0.05 },
	},
};

describe("CoinGecko pricer", () => {
	let get: sinon.SinonStub;
	let clock: sinon.SinonFakeTimers;

	beforeEach(() => {
		get = sinon.stub(axios, "get");
		clock = sinon.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
	});

	afterEach(() => {
		sinon.restore();
		clock.restore();
	});

	it("Maps the CoinGecko ids to the /prices keys", async () => {
		get.resolves(response);
		expect(await new CoinGeckoPricer().getPricesInUSD()).to.deep.equal({
			ban: 0.0005,
			bnb: 730,
			eth: 2400,
			matic: 0.1,
			ftm: 0.05,
		});
	});

	it("Serves cached prices for a minute", async () => {
		get.resolves(response);
		const pricer = new CoinGeckoPricer();
		await pricer.getPricesInUSD();
		clock.tick(59_000);
		await pricer.getPricesInUSD();
		expect(get.callCount).to.equal(1);
		clock.tick(2_000);
		await pricer.getPricesInUSD();
		expect(get.callCount).to.equal(2);
	});

	it("Keeps the last prices when a refresh fails", async () => {
		get.onFirstCall().resolves(response);
		get.onSecondCall().rejects(new Error("rate limited"));
		const pricer = new CoinGeckoPricer();
		await pricer.getPricesInUSD();
		clock.tick(61_000);
		expect((await pricer.getPricesInUSD()).ban).to.equal(0.0005);
	});

	it("Fails without prices to fall back on", async () => {
		get.resolves({ data: { banano: { usd: 0.0005 } } });
		await expect(new CoinGeckoPricer().getPricesInUSD()).to.be.rejectedWith(
			"no USD price for binancecoin"
		);
	});
});

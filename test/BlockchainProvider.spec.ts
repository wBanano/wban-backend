import chai from "chai";
import { ethers } from "ethers";
import config from "../src/config";
import createBlockchainProvider from "../src/BlockchainProvider";

const { expect } = chai;

describe("BlockchainProvider", () => {
	const originalJsonRpc = config.BlockchainJsonRpc;

	afterEach(() => {
		config.BlockchainJsonRpc = originalJsonRpc;
	});

	it("Creates a simple JsonRpcProvider from a single URL", () => {
		config.BlockchainJsonRpc = "http://localhost:8545";
		const provider = createBlockchainProvider();
		expect(provider).to.be.instanceOf(ethers.providers.JsonRpcProvider);
		expect(provider).to.not.be.instanceOf(ethers.providers.FallbackProvider);
		expect(
			(provider as ethers.providers.JsonRpcProvider).connection.url
		).to.equal("http://localhost:8545");
	});

	it("Creates a FallbackProvider from a comma-separated list of URLs", () => {
		config.BlockchainJsonRpc =
			"http://localhost:8545,http://localhost:8546,http://localhost:8547";
		const provider = createBlockchainProvider();
		expect(provider).to.be.instanceOf(ethers.providers.FallbackProvider);
		const fallback = provider as ethers.providers.FallbackProvider;
		expect(fallback.providerConfigs).to.have.length(3);
		expect(fallback.quorum).to.equal(1);
		// URLs should be tried in the order they are listed
		expect(fallback.providerConfigs[0].priority).to.equal(1);
		expect(fallback.providerConfigs[1].priority).to.equal(2);
		expect(fallback.providerConfigs[2].priority).to.equal(3);
	});

	it("Ignores extra whitespace and empty entries in the list", () => {
		config.BlockchainJsonRpc =
			" http://localhost:8545 , ,http://localhost:8546,";
		const provider = createBlockchainProvider();
		expect(provider).to.be.instanceOf(ethers.providers.FallbackProvider);
		const fallback = provider as ethers.providers.FallbackProvider;
		expect(fallback.providerConfigs).to.have.length(2);
	});
});

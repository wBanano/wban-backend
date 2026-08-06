import { ethers } from "ethers";
import config from "./config";

/**
 * Creates the provider used to talk to the blockchain, based on `BC_JSON_RPC_URL`.
 *
 * `BC_JSON_RPC_URL` accepts a single URL (previous behavior) or a comma-separated
 * list of URLs. With multiple URLs, a `FallbackProvider` (quorum of 1) is returned:
 * URLs are tried in the order they are listed, so the bridge stays up as long as
 * at least one endpoint is healthy.
 */
function createBlockchainProvider(): ethers.providers.BaseProvider {
	const network = {
		name: config.BlockchainNetworkName,
		chainId: config.BlockchainNetworkChainId,
	};
	const urls = config.BlockchainJsonRpc.split(",")
		.map((url) => url.trim())
		.filter((url) => url !== "");
	if (urls.length <= 1) {
		return new ethers.providers.JsonRpcProvider(
			urls[0] ?? config.BlockchainJsonRpc,
			network
		);
	}
	return new ethers.providers.FallbackProvider(
		urls.map((url, index) => ({
			provider: new ethers.providers.JsonRpcProvider(url, network),
			priority: index + 1,
			weight: 1,
			stallTimeout: 2_000,
		})),
		// quorum of 1: a single healthy endpoint is enough to get an answer
		1
	);
}

export default createBlockchainProvider;

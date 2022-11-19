import { BigNumber } from "ethers";

interface BlockchainGasPriceTracker {
	getGasPriceTrackerData(): Promise<BigNumber>;
}

export { BlockchainGasPriceTracker };

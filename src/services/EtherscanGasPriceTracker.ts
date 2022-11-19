import { AxiosInstance } from "axios";
import { setup } from "axios-cache-adapter";
import { BigNumber } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import { BlockchainGasPriceTracker } from "./BlockchainGasPriceTracker";
import config from "../config";

class EtherscanGasPriceTracker implements BlockchainGasPriceTracker {
	private api: AxiosInstance;

	constructor() {
		this.api = setup({
			cache: {
				maxAge: 5 * 1000, // cache for 5 seconds
			},
		});
	}

	public async getGasPriceTrackerData(): Promise<BigNumber> {
		const resp = await this.api.get(`${config.BlockchainGasPriceTrackerApi}`);
		return parseUnits(resp.data.result.SafeGasPrice, "gwei");
	}
}

export { EtherscanGasPriceTracker };

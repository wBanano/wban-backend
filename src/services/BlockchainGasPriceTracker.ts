import { AxiosInstance } from "axios";
import { setup } from "axios-cache-adapter";
import { Logger } from "tslog";
import config from "../config";

class BlockchainGasPriceTracker {
	private api: AxiosInstance;

	constructor() {
		this.api = setup({
			cache: {
				maxAge: 5 * 1000, // cache for 15 seconds
			},
		});
	}

	public async getGasPriceTrackerData(): Promise<string> {
		const resp = await this.api.get(`${config.BlockchainGasPriceTrackerApi}`);
		return resp.data.result;
	}
}

export { BlockchainGasPriceTracker };

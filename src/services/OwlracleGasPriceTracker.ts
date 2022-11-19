import { AxiosInstance } from "axios";
import { setup } from "axios-cache-adapter";
import { BigNumber } from "ethers";
import { parseUnits } from "ethers/lib/utils";
import { BlockchainGasPriceTracker } from "./BlockchainGasPriceTracker";
import config from "../config";

type Speed = {
	acceptance: number;
	gasPrice: number;
	estimatedFee: number;
};

class OwlracleGasPriceTracker implements BlockchainGasPriceTracker {
	private api: AxiosInstance;

	constructor() {
		this.api = setup({
			cache: {
				maxAge: 2 * 60 * 1000, // cache for 2 minutes
			},
		});
	}

	public async getGasPriceTrackerData(): Promise<BigNumber> {
		const chainId = config.BlockchainNetworkChainId;
		const apiKey = config.BlockchainGasPriceTrackerApiKey;
		const resp = await this.api.get(
			`https://api.owlracle.info/v3/${chainId}/gas?apikey=${apiKey}&eip1559=false&accept=90`
		);
		const { speeds } = resp.data;
		const safeSpeed: Speed | undefined = speeds.find(
			(speed: Speed) => speed.acceptance > 0.9
		);
		if (safeSpeed === undefined) {
			throw new Error("Can't fetch gas price");
		}
		return parseUnits(safeSpeed.gasPrice.toString(), "gwei");
	}
}

export { OwlracleGasPriceTracker };

import { AxiosInstance } from "axios";
import { setup } from "axios-cache-adapter";
import { TokenPricer } from "./TokenPricer";

class CoinExPricer implements TokenPricer {
	private market;

	private api: AxiosInstance;

	constructor(market: string) {
		this.market = market;
		this.api = setup({
			cache: {
				maxAge: 30 * 1000, // cache for 30 seconds
			},
		});
	}

	async getPriceInUSD(): Promise<number> {
		const resp = await this.api.request({
			url: `https://api.coinex.com/v1/market/ticker?market=${this.market}`,
		});
		const apiResponse = resp.data;
		if (!apiResponse?.data?.ticker?.last) {
			throw new Error("CoinEx API response does not contain last price");
		}
		return Number.parseFloat(apiResponse.data.ticker.last);
	}
}

export { CoinExPricer };

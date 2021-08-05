import axios from "axios";
import { TokenPricer } from "./TokenPricer";

class CoinExPricer implements TokenPricer {
	private market;

	constructor(market: string) {
		this.market = market;
	}

	async getPriceInUSD(): Promise<number> {
		const resp = await axios.request({
			url: `https://api.coinex.com/v1/market/ticker?market=${this.market}`,
		});
		const apiResponse = resp.data;
		return Number.parseFloat(apiResponse.data.ticker.last);
	}
}

export { CoinExPricer };

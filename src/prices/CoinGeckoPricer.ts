import axios from "axios";
import { Logger } from "tslog";
import config from "../config";

const COINGECKO_IDS = {
	ban: "banano",
	bnb: "binancecoin",
	eth: "ethereum",
	matic: "polygon-ecosystem-token",
	ftm: "sonic-3",
};

type Prices = Record<keyof typeof COINGECKO_IDS, number>;

const MAX_AGE_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;

class CoinGeckoPricer {
	private prices: Prices | undefined;

	private fetchedAt = 0;

	private failedAt = 0;

	private log: Logger = config.Logger.getChildLogger();

	async getPricesInUSD(): Promise<Prices> {
		const now = Date.now();
		if (this.prices && now - this.fetchedAt < MAX_AGE_MS) {
			return this.prices;
		}
		if (now - this.failedAt < RETRY_DELAY_MS) {
			return this.lastPrices();
		}
		try {
			this.prices = await CoinGeckoPricer.fetchPrices();
			this.fetchedAt = now;
		} catch (err: unknown) {
			this.failedAt = now;
			this.log.warn("Can't fetch prices from CoinGecko", err);
			return this.lastPrices();
		}
		return this.prices;
	}

	private lastPrices(): Prices {
		if (!this.prices) {
			throw new Error("No prices from CoinGecko yet");
		}
		return this.prices;
	}

	private static async fetchPrices(): Promise<Prices> {
		const resp = await axios.get(
			"https://api.coingecko.com/api/v3/simple/price",
			{
				params: {
					ids: Object.values(COINGECKO_IDS).join(","),
					vs_currencies: "usd",
				},
				timeout: 10_000,
			}
		);
		const entries = Object.entries(COINGECKO_IDS).map(([symbol, id]) => {
			const usd = resp.data?.[id]?.usd;
			if (typeof usd !== "number") {
				throw new Error(`CoinGecko response has no USD price for ${id}`);
			}
			return [symbol, usd];
		});
		return Object.fromEntries(entries) as Prices;
	}
}

export { CoinGeckoPricer };

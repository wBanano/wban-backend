import { AxiosInstance } from "axios";
import { setup } from "axios-cache-adapter";
import { Logger } from "tslog";
import config from "../config";

class TokensList {
	private api: AxiosInstance;

	private log: Logger = config.Logger.getChildLogger();

	constructor() {
		this.api = setup({
			cache: {
				maxAge: 60 * 60 * 1000,
			},
		});
	}

	public async getTokensList(): Promise<string> {
		const resp = await this.api.get(config.BlockchainDexTokensList);
		return resp.data;
	}
}

export { TokensList };

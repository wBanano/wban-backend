import { AxiosInstance } from "axios";
import { setup } from "axios-cache-adapter";
import { Logger } from "tslog";
import config from "../config";
import {
	BananoWalletsBlacklist,
	BlacklistRecord,
} from "./BananoWalletsBlacklist";

class KirbyBananoWalletsBlacklist implements BananoWalletsBlacklist {
	private api: AxiosInstance;

	private log: Logger = config.Logger.getChildLogger();

	constructor() {
		this.api = setup({
			cache: {
				maxAge: 60 * 60 * 1000,
			},
		});
	}

	async getBlacklistedWallets(): Promise<Array<BlacklistRecord>> {
		const resp = await this.api.get(
			"https://kirby.eu.pythonanywhere.com/api/v1/resources/addresses/all"
		);
		return resp.data as Array<BlacklistRecord>;
	}

	async isBlacklisted(banWallet: string): Promise<BlacklistRecord | undefined> {
		const blacklist = await this.getBlacklistedWallets();
		const result = blacklist.find((record) => record.address === banWallet);
		this.log.debug(
			`Blacklist check for "${banWallet}": ${JSON.stringify(result)}`
		);
		return result;
	}
}

export default KirbyBananoWalletsBlacklist;

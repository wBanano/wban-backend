import { ethers, BigNumber, ContractTransaction, Wallet } from "ethers";
import { Logger } from "tslog";
import {
	WBANToken,
	// eslint-disable-next-line camelcase
	WBANToken__factory,
} from "wban-smart-contract";
import config from "./config";

class BSC {
	private wBAN: WBANToken;

	private wallet: Wallet;

	private provider: ethers.providers.JsonRpcProvider;

	private log: Logger = config.Logger.getChildLogger();

	constructor() {
		try {
			this.provider = new ethers.providers.JsonRpcProvider(
				config.BinanceSmartChainJsonRpc,
				{
					name: config.BinanceSmartChainNetworkName,
					chainId: config.BinanceSmartChainNetworkChainId,
				}
			);
			this.wallet = Wallet.fromMnemonic(
				config.BinanceSmartChainWalletMnemonic
			).connect(this.provider);
			this.wBAN = WBANToken__factory.connect(
				config.WBANContractAddress,
				this.wallet
			);
			this.wBAN
				.owner()
				.then((owner) => this.log.debug(`Contract owner: ${owner}`));
		} catch (err) {
			this.log.error(
				"Couldn't properly initialize connection to Binance Smart Chain",
				err
			);
			throw err;
		}
	}

	async mintTo(address: string, amount: BigNumber): Promise<string> {
		this.log.debug("in mint");
		const txn: ContractTransaction = await this.wBAN.mintTo(
			address,
			amount,
			61_000,
			{
				gasLimit: 61_000,
				gasPrice: "20000000000", // 20 Gwei
			}
		);
		return txn.hash;
	}
}

export { BSC };

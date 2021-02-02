import { ethers, BigNumber, Wallet, ContractTransaction } from "ethers";
import { Logger } from "tslog";
import {
	WBANToken,
	// eslint-disable-next-line camelcase
	WBANToken__factory,
} from "wban-smart-contract";
import BSCTransactionFailedError from "./errors/BSCTransactionFailedError";
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
			config.WBANMintGasPrice,
			{
				gasLimit: config.WBANMintGasPrice,
				gasPrice: config.WBANMintGasLimit,
			}
		);
		try {
			await txn.wait();
		} catch (err) {
			this.log.error("Transaction failed. Should credit BAN back!");
			throw new BSCTransactionFailedError(txn.hash, err);
		}
		return txn.hash;
	}
}

export { BSC };

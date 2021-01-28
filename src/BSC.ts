import { ethers, BigNumber, ContractTransaction } from "ethers";
import { Logger } from "tslog";
import {
	WBANToken,
	// eslint-disable-next-line camelcase
	WBANToken__factory,
} from "../../wban-dApp/artifacts/typechain";
// import { WBANToken, WBANToken__factory } from '@artifacts/typechain'
import config from "./config";

class BSC {
	private wBAN: WBANToken;

	private provider: ethers.providers.JsonRpcProvider;

	private log: Logger = config.Logger.getChildLogger();

	constructor() {
		this.provider = new ethers.providers.JsonRpcProvider(
			config.BinanceSmartChainJsonRpc,
			{
				name: config.BinanceSmartChainNetworkName,
				chainId: config.BinanceSmartChainNetworkChainId,
			}
		);
		this.wBAN = WBANToken__factory.connect(
			config.WBANContractAddress,
			this.provider.getSigner()
		);
		this.wBAN
			.owner()
			.then((owner) => this.log.debug(`Contract owner: ${owner}`));
	}

	async mintTo(address: string, amount: BigNumber): Promise<string> {
		this.log.debug("in mint");
		const txn: ContractTransaction = await this.wBAN.mintTo(
			address,
			amount,
			200_000
		);
		return txn.hash;
		/*
		const contract: WBANToken | null = contracts.wbanContract
		if (contract && this.mintToAddress) {
			const rawAmount: string = ethers.utils.parseEther(this.mintAmount).toString()
			await contract.mintTo(this.mintToAddress, rawAmount, 200_000)
			contract.on('Transfer', () => {
				console.info('wBAN were minted!')
				this.reloadBalances()
			})
		}
		*/
	}
}

export { BSC };

import { ethers, BigNumber, Wallet, ContractTransaction } from "ethers";
import { Logger } from "tslog";
import {
	WBANToken,
	// eslint-disable-next-line camelcase
	WBANToken__factory,
} from "wban-smart-contract";
import cron from "node-cron";
import SwapToBanEvent from "./models/events/SwapToBanEvent";
import { SwapToBanEventListener } from "./models/listeners/SwapToBanEventListener";
import BSCTransactionFailedError from "./errors/BSCTransactionFailedError";
import { UsersDepositsService } from "./services/UsersDepositsService";
import config from "./config";

class BSC {
	private wBAN: WBANToken;

	private wallet: Wallet;

	private provider: ethers.providers.JsonRpcProvider;

	private listeners: SwapToBanEventListener[] = [];

	private usersDepositsService: UsersDepositsService;

	private log: Logger = config.Logger.getChildLogger();

	constructor(usersDepositsService: UsersDepositsService) {
		this.usersDepositsService = usersDepositsService;

		if (config.BinanceSmartChainNetworkName === "none") {
			return;
		}
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
			// listen for `SwapToBan` events
			this.wBAN.on(
				this.wBAN.filters.SwapToBan(null, null, null),
				async (
					from: string,
					banAddress: string,
					amount: BigNumber,
					event: ethers.Event
				) => {
					await this.handleSwapToBanEvents({
						from,
						banAddress,
						amount,
						hash: event.transactionHash,
					});
				}
			);
			if (
				config.BinanceSmartChainWalletPendingTransactionsThreadEnabled === true
			) {
				cron.schedule("*/1 * * * *", async () => {
					this.processBlocks();
				});
			} else {
				this.log.warn(
					"Ignoring checks of pending transactions. Only do this for running tests!"
				);
			}
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

	async processBlocks(): Promise<void> {
		const latestBlockProcessed: number = await this.usersDepositsService.getLastBSCBlockProcessed();
		const currentBlock: number = await this.provider.getBlockNumber();
		this.log.info(
			`Processing blocks from ${latestBlockProcessed} to ${currentBlock}...`
		);
		const logs: ethers.Event[] = await this.wBAN.queryFilter(
			this.wBAN.filters.SwapToBan(null, null, null),
			latestBlockProcessed,
			currentBlock
		);
		const events: SwapToBanEvent[] = logs.map((log) => {
			const parsedLog = this.wBAN.interface.parseLog(log);
			return {
				from: parsedLog.args.from,
				banAddress: parsedLog.args.ban_address,
				amount: BigNumber.from(parsedLog.args.amount),
				hash: log.transactionHash,
			};
		});
		events.forEach(async (swapEvent) => {
			await this.handleSwapToBanEvents(swapEvent);
		});
		this.usersDepositsService.setLastBSCBlockProcessed(currentBlock);
	}

	private async handleSwapToBanEvents(
		swapEvent: SwapToBanEvent
	): Promise<void> {
		this.log.debug(
			`Detected a SwapToBan event. From: ${swapEvent.from}, to: ${
				swapEvent.banAddress
			}, amount: ${ethers.utils.formatEther(swapEvent.amount)}, hash: ${
				swapEvent.hash
			}`
		);
		// notify listeners
		this.listeners.forEach((listener) => listener(swapEvent));
	}

	onSwapToBan(listener: SwapToBanEventListener): void {
		this.listeners.push(listener);
	}
}

export { BSC };

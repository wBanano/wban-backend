import { ethers, BigNumber, Wallet, ContractTransaction } from "ethers";
import { Logger } from "tslog";
import {
	WBANToken,
	// eslint-disable-next-line camelcase
	WBANToken__factory,
} from "wban-smart-contract";
import SwapWBANToBan from "./models/operations/SwapWBANToBan";
import { SwapToBanEventListener } from "./models/listeners/SwapToBanEventListener";
import BSCTransactionFailedError from "./errors/BSCTransactionFailedError";
import { UsersDepositsService } from "./services/UsersDepositsService";
import config from "./config";
import RepeatableQueue from "./services/queuing/RepeatableQueue";

class BSC {
	private wBAN: WBANToken;

	private wallet: Wallet;

	private provider: ethers.providers.JsonRpcProvider;

	private listeners: SwapToBanEventListener[] = [];

	private usersDepositsService: UsersDepositsService;

	private log: Logger = config.Logger.getChildLogger();

	constructor(
		usersDepositsService: UsersDepositsService,
		repeatableQueue: RepeatableQueue
	) {
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
					bscWallet: string,
					banWallet: string,
					amount: BigNumber,
					event: ethers.Event
				) => {
					const block = await this.provider.getBlock(event.blockNumber);
					const date = new Date(block.timestamp).toISOString();
					const wbanBalance = await this.wBAN.balanceOf(bscWallet);
					await this.provider.waitForTransaction(event.transactionHash, 5);
					await this.handleSwapToBanEvents({
						bscWallet,
						banWallet,
						amount: ethers.utils.formatEther(amount),
						wbanBalance: ethers.utils.formatEther(wbanBalance),
						hash: event.transactionHash,
						date,
						checkUserBalance: false,
					});
				}
			);
			if (
				config.BinanceSmartChainWalletPendingTransactionsThreadEnabled === true
			) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				repeatableQueue.registerProcessor("bsc-scan", async (job) => {
					await this.processBlocks();
				});
				// scan BSC blockchain every 30 seconds
				repeatableQueue
					.schedulePeriodicJob("bsc-scan", 30_000)
					.then(() => repeatableQueue.start());
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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async mintTo(address: string, amount: BigNumber): Promise<any> {
		this.log.debug(
			`Minting ${ethers.utils.formatEther(amount)} BAN to ${address}`
		);
		const txn: ContractTransaction = await this.wBAN.mintTo(
			address,
			amount,
			config.WBANMintGasLimit,
			{
				gasLimit: config.WBANMintGasLimit,
				gasPrice: config.WBANMintGasPrice,
			}
		);
		try {
			await txn.wait();
		} catch (err) {
			this.log.error("Transaction failed.", err);
			throw new BSCTransactionFailedError(txn.hash, err);
		}
		const wbanBalance: BigNumber = await this.wBAN.balanceOf(address);
		return {
			hash: txn.hash,
			wbanBalance,
		};
	}

	async processBlocks(): Promise<void> {
		try {
			const latestBlockProcessed: number = await this.usersDepositsService.getLastBSCBlockProcessed();
			const currentBlock: number = await this.provider.getBlockNumber();
			this.log.info(
				`Processing blocks from ${
					latestBlockProcessed + 1
				} to ${currentBlock}...`
			);
			const logs: ethers.Event[] = await this.wBAN.queryFilter(
				this.wBAN.filters.SwapToBan(null, null, null),
				latestBlockProcessed + 1,
				currentBlock
			);
			const events: SwapWBANToBan[] = await Promise.all(
				logs.map(async (log) => {
					const parsedLog = this.wBAN.interface.parseLog(log);
					const block = await this.provider.getBlock(log.blockNumber);
					const date = new Date(block.timestamp).toISOString();
					const { from } = parsedLog.args;
					const wbanBalance = await this.wBAN.balanceOf(from);
					return {
						bscWallet: from,
						banWallet: parsedLog.args.ban_address,
						amount: ethers.utils.formatEther(
							BigNumber.from(parsedLog.args.amount)
						),
						wbanBalance: ethers.utils.formatEther(wbanBalance),
						hash: log.transactionHash,
						date,
						checkUserBalance: false,
					};
				})
			);
			events.forEach(async (swapEvent) => {
				await this.handleSwapToBanEvents(swapEvent);
			});
			this.usersDepositsService.setLastBSCBlockProcessed(currentBlock);
		} catch (err) {
			this.log.error(`Couldn't process BSC blocks`, err);
			throw err;
		}
	}

	private async handleSwapToBanEvents(swap: SwapWBANToBan): Promise<void> {
		this.log.debug(
			`Detected a SwapToBan event. From: ${swap.bscWallet}, to: ${swap.banWallet}, amount: ${swap.amount}, hash: ${swap.hash}`
		);
		// notify listeners
		this.listeners.forEach((listener) => listener(swap));
	}

	onSwapToBAN(listener: SwapToBanEventListener): void {
		this.listeners.push(listener);
	}
}

export { BSC };

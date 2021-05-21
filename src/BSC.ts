import { ethers, BigNumber, Wallet } from "ethers";
import { Logger } from "tslog";
import {
	WBANToken,
	// eslint-disable-next-line camelcase
	WBANToken__factory,
} from "wban-smart-contract";
import SwapWBANToBan from "./models/operations/SwapWBANToBan";
import { SwapToBanEventListener } from "./models/listeners/SwapToBanEventListener";
import { UsersDepositsService } from "./services/UsersDepositsService";
import config from "./config";
import BSCScanQueue from "./services/queuing/BSCScanQueue";

class BSC {
	private wBAN: WBANToken;

	private wallet: Wallet;

	private provider: ethers.providers.JsonRpcProvider;

	private listeners: SwapToBanEventListener[] = [];

	private usersDepositsService: UsersDepositsService;

	private log: Logger = config.Logger.getChildLogger();

	constructor(
		usersDepositsService: UsersDepositsService,
		bscScanQueue: BSCScanQueue
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
					const { timestamp } = block;
					const wbanBalance = await this.wBAN.balanceOf(bscWallet);
					await this.provider.waitForTransaction(event.transactionHash, 5);
					await this.handleSwapToBanEvents({
						bscWallet,
						banWallet,
						amount: ethers.utils.formatEther(amount),
						wbanBalance: ethers.utils.formatEther(wbanBalance),
						hash: event.transactionHash,
						timestamp: timestamp * 1_000,
					});
				}
			);
			if (
				config.BinanceSmartChainWalletPendingTransactionsThreadEnabled === true
			) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				bscScanQueue.registerProcessor("bsc-scan", async (job) => {
					const { blockFrom, blockTo } = job.data;
					return this.processBlocks(blockFrom, blockTo);
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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async createMintReceipt(address: string, amount: BigNumber): Promise<any> {
		this.log.debug(
			`Forging mint receipt for ${ethers.utils.formatEther(
				amount
			)} BAN to ${address}`
		);
		const uuid = Date.now();
		const payload = ethers.utils.defaultAbiCoder.encode(
			["address", "uint256", "uint256"],
			[address, amount, uuid]
		);
		const payloadHash = ethers.utils.keccak256(payload);
		const receipt = await this.wallet.signMessage(
			ethers.utils.arrayify(payloadHash)
		);
		const wbanBalance: BigNumber = await this.wBAN.balanceOf(address);
		return {
			receipt,
			uuid,
			wbanBalance,
		};
	}

	private async processBlocks(
		blockFrom: number,
		blockTo: number
	): Promise<string> {
		try {
			this.log.info(`Processing blocks from ${blockFrom} to ${blockTo}...`);
			const logs: ethers.Event[] = await this.wBAN.queryFilter(
				this.wBAN.filters.SwapToBan(null, null, null),
				blockFrom,
				blockTo
			);
			const events: SwapWBANToBan[] = await Promise.all(
				logs.map(async (log) => {
					const parsedLog = this.wBAN.interface.parseLog(log);
					const block = await this.provider.getBlock(log.blockNumber);
					const { timestamp } = block;
					const { from, banAddress, amount } = parsedLog.args;
					const wbanBalance = await this.wBAN.balanceOf(from);
					return {
						bscWallet: from,
						banWallet: banAddress,
						amount: ethers.utils.formatEther(BigNumber.from(amount)),
						wbanBalance: ethers.utils.formatEther(wbanBalance),
						hash: log.transactionHash,
						timestamp: timestamp * 1_000,
						checkUserBalance: false,
					};
				})
			);
			await Promise.all(
				events.map((event) => this.handleSwapToBanEvents(event))
			);
			this.usersDepositsService.setLastBSCBlockProcessed(blockTo);
			return `Processed blocks from ${blockFrom} to ${blockTo}...`;
		} catch (err) {
			this.log.error(`Couldn't process BSC blocks`, err);
			throw err;
		}
	}

	private async handleSwapToBanEvents(swap: SwapWBANToBan): Promise<void> {
		this.log.debug(
			`Detected a SwapToBan event. From: ${swap.bscWallet}, to: ${swap.banWallet}, amount: ${swap.amount}, hash: ${swap.hash}`
		);
		if (!swap.bscWallet) {
			throw new Error("Missing BSC address in BSC event!");
		}
		if (!swap.banWallet) {
			throw new Error("Missing BAN address in BSC event!");
		}
		if (!swap.amount) {
			throw new Error("Missing amount in BSC event!");
		}
		// notify listeners
		this.listeners.forEach((listener) => listener(swap));
	}

	onSwapToBAN(listener: SwapToBanEventListener): void {
		this.listeners.push(listener);
	}
}

export { BSC };

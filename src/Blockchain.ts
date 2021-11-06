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
import BlockchainScanQueue from "./services/queuing/BlockchainScanQueue";

class Blockchain {
	private wBAN: WBANToken;

	private wallet: Wallet;

	private provider: ethers.providers.JsonRpcProvider;

	private listeners: SwapToBanEventListener[] = [];

	private usersDepositsService: UsersDepositsService;

	private log: Logger = config.Logger.getChildLogger();

	constructor(
		usersDepositsService: UsersDepositsService,
		blockchainScanQueue: BlockchainScanQueue
	) {
		this.usersDepositsService = usersDepositsService;

		if (config.BlockchainNetworkName === "none") {
			return;
		}
		try {
			this.provider = new ethers.providers.JsonRpcProvider(
				config.BlockchainJsonRpc,
				{
					name: config.BlockchainNetworkName,
					chainId: config.BlockchainNetworkChainId,
				}
			);
			this.wallet = Wallet.fromMnemonic(
				config.BlockchainWalletMnemonic
			).connect(this.provider);
			this.wBAN = WBANToken__factory.connect(
				config.WBANContractAddress,
				this.wallet
			);
			// listen for `SwapToBan` events
			this.wBAN.on(
				this.wBAN.filters.SwapToBan(null, null, null),
				async (
					blockchainWallet: string,
					banWallet: string,
					amount: BigNumber,
					event: ethers.Event
				) => {
					const block = await this.provider.getBlock(event.blockNumber);
					const { timestamp } = block;
					const wbanBalance = await this.wBAN.balanceOf(blockchainWallet);
					await this.provider.waitForTransaction(event.transactionHash, 5);
					await this.handleSwapToBanEvents({
						blockchainWallet,
						banWallet,
						amount: ethers.utils.formatEther(amount),
						wbanBalance: ethers.utils.formatEther(wbanBalance),
						hash: event.transactionHash,
						timestamp: timestamp * 1_000,
					});
				}
			);
			if (config.BlockchainWalletPendingTransactionsThreadEnabled === true) {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				blockchainScanQueue.registerProcessor("bc-scan", async (job) => {
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

	async processBlocks(blockFrom: number, blockTo: number): Promise<string> {
		const BLOCK_SLICE = 1_000;
		try {
			this.log.info(`Processing blocks from ${blockFrom} to ${blockTo}...`);

			const numberOfSlices: number =
				Math.floor((blockTo - blockFrom) / BLOCK_SLICE) + 1;
			this.log.trace(`# of slices: ${numberOfSlices}`);
			let blockSliceFrom: number = blockFrom;
			let blockSliceTo: number = Math.min(
				blockSliceFrom + BLOCK_SLICE - 1,
				blockTo
			);

			for (let slice = 0; slice < numberOfSlices; slice += 1) {
				this.log.trace(`Processing slice ${blockSliceFrom} -> ${blockSliceTo}`);
				// eslint-disable-next-line no-await-in-loop
				await this.processBlocksSlice(blockSliceFrom, blockSliceTo);
				blockSliceFrom += blockSliceTo - blockSliceFrom + 1;
				blockSliceTo += Math.min(BLOCK_SLICE, blockTo - blockSliceFrom + 1);
			}

			return `Processed blocks from ${blockFrom} to ${blockTo}...`;
		} catch (err) {
			this.log.error(`Couldn't process Blockchain blocks`, err);
			throw err;
		}
	}

	async processBlocksSlice(
		blockFrom: number,
		blockTo: number
	): Promise<string> {
		try {
			const logs = await this.wBAN.queryFilter(
				this.wBAN.filters.SwapToBan(null, null, null),
				blockFrom,
				blockTo
			);
			const events = await Promise.all(
				logs.map(async (log) => {
					const parsedLog = this.wBAN.interface.parseLog(log);
					const block = await this.provider.getBlock(log.blockNumber);
					const { timestamp } = block;
					const { from, banAddress, amount } = parsedLog.args;
					const wbanBalance = await this.wBAN.balanceOf(from);
					return {
						blockchainWallet: from,
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
			this.usersDepositsService.setLastBlockchainBlockProcessed(blockTo);
			return `Processed blocks slice from ${blockFrom} to ${blockTo}...`;
		} catch (err) {
			this.log.error(
				`Couldn't process Blockchain blocks slice ${blockFrom} to ${blockTo}`,
				err
			);
			throw err;
		}
	}

	private async handleSwapToBanEvents(swap: SwapWBANToBan): Promise<void> {
		this.log.debug(
			`Detected a SwapToBan event. From: ${swap.blockchainWallet}, to: ${swap.banWallet}, amount: ${swap.amount}, hash: ${swap.hash}`
		);
		if (!swap.blockchainWallet) {
			throw new Error("Missing Blockchain address in Blockchain event!");
		}
		if (!swap.banWallet) {
			throw new Error("Missing BAN address in Blockchain event!");
		}
		if (!swap.amount) {
			throw new Error("Missing amount in Blockchain event!");
		}
		// notify listeners
		this.listeners.forEach((listener) => listener(swap));
	}

	onSwapToBAN(listener: SwapToBanEventListener): void {
		this.listeners.push(listener);
	}
}

export { Blockchain };
import { Logger } from "tslog";
import { BigNumber, ethers, Signature } from "ethers";
import { Processor } from "bullmq";
import { Relayer, RelayerTransaction } from "defender-relay-client";
import {
	DefenderRelaySigner,
	DefenderRelayProvider,
} from "defender-relay-client/lib/ethers";
import {
	// eslint-disable-next-line camelcase
	WBANTokenWithPermit__factory,
	// eslint-disable-next-line camelcase
	WBANGaslessSwap__factory,
} from "wban-smart-contract";
import { Banano } from "../Banano";
import config from "../config";
import { UsersDepositsService } from "./UsersDepositsService";
import InvalidSignatureError from "../errors/InvalidSignatureError";
import InvalidOwner from "../errors/InvalidOwner";
import InsufficientBalanceError from "../errors/InsufficientBalanceError";
import { ClaimResponse } from "../models/responses/ClaimResponse";
import { Blockchain } from "../Blockchain";
import ProcessingQueue from "./queuing/ProcessingQueue";
import { OperationsNames } from "../models/operations/Operation";
import BananoUserWithdrawal from "../models/operations/BananoUserWithdrawal";
import SwapBanToWBAN from "../models/operations/SwapBanToWBAN";
import SwapWBANToBan from "../models/operations/SwapWBANToBan";
import GaslessSwap from "../models/operations/GaslessSwap";
import History from "../models/responses/History";
import BlockchainScanQueue from "./queuing/BlockchainScanQueue";
import { BananoWalletsBlacklist } from "./BananoWalletsBlacklist";

class Service {
	banano: Banano;

	public blockchain: Blockchain;

	private usersDepositsService: UsersDepositsService;

	private processingQueue: ProcessingQueue;

	private blockchainScanQueue: BlockchainScanQueue;

	private bananoWalletsBlacklist: BananoWalletsBlacklist;

	private relayer: Relayer | undefined;
	private relayerSigner: DefenderRelaySigner | undefined;

	private sleep = (ms: number) => new Promise((resolve: any) => setTimeout(resolve, ms))

	private log: Logger = config.Logger.getChildLogger();

	constructor(
		usersDepositsService: UsersDepositsService,
		processingQueue: ProcessingQueue,
		blockchainScanQueue: BlockchainScanQueue,
		bananoWalletsBlacklist: BananoWalletsBlacklist
	) {
		this.processingQueue = processingQueue;
		this.blockchainScanQueue = blockchainScanQueue;
		this.banano = new Banano(
			config.BananoUsersDepositsHotWallet,
			config.BananoUsersDepositsColdWallet,
			config.BananoSeed,
			config.BananoSeedIdx,
			config.BananoRepresentative,
			usersDepositsService,
			this.processingQueue
		);
		this.processingQueue.registerProcessor(
			OperationsNames.BananoWithdrawal,
			async (job) => {
				const withdrawal: BananoUserWithdrawal = job.data;
				const processor = this.withdrawalProcessor(withdrawal.signature);
				return processor(job);
			}
		);
		this.processingQueue.registerProcessor(
			OperationsNames.SwapToWBAN,
			async (job) => {
				const swap: SwapBanToWBAN = job.data;
				const {
					receipt,
					uuid,
					wbanBalance,
					gasless,
					txnHash,
				} = await this.processSwapToWBAN(swap);
				return {
					banWallet: swap.from,
					blockchainWallet: swap.blockchainWallet,
					swapped: swap.amount,
					receipt,
					uuid,
					gasless,
					txnHash,
					balance: ethers.utils.formatEther(
						await this.usersDepositsService.getUserAvailableBalance(swap.from)
					),
					wbanBalance: ethers.utils.formatEther(wbanBalance),
				};
			}
		);
		this.processingQueue.registerProcessor(
			OperationsNames.SwapToBAN,
			async (job) => {
				const swap: SwapWBANToBan = job.data;
				const { hash, wbanBalance } = await this.processSwapToBAN(swap);
				return {
					banWallet: swap.banWallet,
					swapped: swap.amount,
					balance: ethers.utils.formatEther(
						await this.usersDepositsService.getUserAvailableBalance(
							swap.banWallet
						)
					),
					wbanBalance,
					transaction: hash,
					transactionLink: `${config.BlockchainBlockExplorerUrl}/tx/${hash}`,
				};
			}
		);
		this.processingQueue.registerProcessor(
			OperationsNames.GaslessSwapToETH,
			async (job) => {
				const swap: GaslessSwap & { banWallet: string }  = job.data;
				const { txnId, txnHash } = await this.processGaslessSwap(swap);
				return {
					txnId,
					txnHash,
					txnLink: `${config.BlockchainBlockExplorerUrl}/tx/${txnHash}`,
				};
			}
		);
		this.blockchain = new Blockchain(
			usersDepositsService,
			this.blockchainScanQueue
		);
		this.blockchain.onSwapToBAN((swap: SwapWBANToBan) => this.swapToBAN(swap));
		this.usersDepositsService = usersDepositsService;
		this.bananoWalletsBlacklist = bananoWalletsBlacklist;

		if (config.BlockchainRelayerEnabled === true) {
			const credentials = {
				apiKey: config.BlockchainRelayerApiKey,
				apiSecret: config.BlockchainRelayerSecretKey,
			};
			this.relayer = new Relayer(credentials);
			const provider = new DefenderRelayProvider(credentials);
			this.relayerSigner = new DefenderRelaySigner(credentials, provider, {
				speed: "fast",
				validForSeconds: 300, // relayed transaction valid for 5 minutes
			});
		}
	}

	start(): void {
		this.processingQueue.start();
		this.blockchainScanQueue.start();
		this.banano.subscribeToBananoNotificationsForWallet();
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		return this.usersDepositsService.getUserAvailableBalance(from);
	}

	// check if the user already claimed his addresses
	async claimAvailable(
		banWallet: string,
		blockchainWallet: string
	): Promise<boolean> {
		return this.usersDepositsService.hasClaim(banWallet, blockchainWallet);
	}

	async claim(
		banWallet: string,
		blockchainWallet: string,
		signature: string
	): Promise<ClaimResponse> {
		// verify signature
		if (
			!this.checkSignature(
				blockchainWallet,
				signature,
				`I hereby claim that the BAN address "${banWallet}" is mine`
			)
		) {
			return ClaimResponse.InvalidSignature;
		}
		// check if the address is blacklisted
		const blacklisted = await this.bananoWalletsBlacklist.isBlacklisted(
			banWallet
		);
		if (blacklisted !== undefined) {
			this.log.warn(
				`Can't claim "${banWallet}. This is a blacklisted wallet linked to ${blacklisted.alias}`
			);
			return ClaimResponse.Blacklisted;
		}
		// check if the user already did the claim process
		if (await this.usersDepositsService.isClaimed(banWallet)) {
			const claimedFromOriginalOwner = await this.usersDepositsService.hasClaim(
				banWallet,
				blockchainWallet
			);
			return claimedFromOriginalOwner
				? ClaimResponse.AlreadyDone
				: ClaimResponse.InvalidOwner;
		}
		// check if there is a pending claim
		if (!(await this.usersDepositsService.hasPendingClaim(banWallet))) {
			return (await this.usersDepositsService.storePendingClaim(
				banWallet,
				blockchainWallet
			))
				? ClaimResponse.Ok
				: ClaimResponse.Error;
		}
		// assume this is another user who tried to do this
		return ClaimResponse.InvalidOwner;
	}

	async withdrawBAN(
		banWallet: string,
		amount: string,
		blockchainWallet: string,
		timestamp: number,
		signature: string
	): Promise<string> {
		return this.processingQueue.addBananoUserWithdrawal({
			banWallet,
			amount,
			blockchainWallet,
			signature,
			timestamp,
			attempt: 0,
		});
	}

	async processWithdrawBAN(
		withdrawal: BananoUserWithdrawal,
		signature?: string
	): Promise<string> {
		const { banWallet, amount, blockchainWallet, timestamp } = withdrawal;

		this.log.info(
			`Processing user withdrawal request of "${amount}" BAN from wallet "${banWallet}"`
		);

		// check if request was already processed
		if (
			await this.usersDepositsService.containsUserWithdrawalRequest(withdrawal)
		) {
			this.log.warn(
				`User withdrawal request to "${banWallet}" at ${timestamp} was already processed`
			);
			throw new Error(
				"Can't withdraw BAN as the transaction was already processed"
			);
		}

		// verify signature
		if (
			signature &&
			!this.checkSignature(
				blockchainWallet,
				signature,
				`Withdraw ${amount} BAN to my wallet "${banWallet}"`
			)
		) {
			throw new InvalidSignatureError();
		}

		// verify is the claim was previously done
		if (!(await this.usersDepositsService.isClaimed(banWallet))) {
			throw new Error(`Can't withdraw from unclaimed wallet ${banWallet}`);
		} else if (
			!(await this.usersDepositsService.hasClaim(banWallet, blockchainWallet))
		) {
			throw new Error("Can't withdraw from another Blockchain wallet");
		}

		const withdrawnAmount: BigNumber = ethers.utils.parseEther(amount);

		// check for positive amounts
		if (withdrawnAmount.isNegative()) {
			throw new Error("Can't withdraw negative amounts of BAN");
		}

		// check if deposits are greater than or equal to amount to withdraw
		const availableBalance: BigNumber = await this.usersDepositsService.getUserAvailableBalance(
			banWallet
		);
		if (!availableBalance.gte(withdrawnAmount)) {
			const message = `User "${banWallet}" has not deposited enough BAN for a withdrawal of ${amount} BAN. Deposited balance is: ${ethers.utils.formatEther(
				availableBalance
			)} BAN`;
			this.log.warn(message);
			throw new InsufficientBalanceError(message);
		}

		// send the BAN to the user
		const { pending, hash } = await this.eventuallySendBan(withdrawal);

		if (pending || !hash) {
			return "";
		}

		// decrease user deposits
		await this.usersDepositsService.storeUserWithdrawal(
			banWallet,
			withdrawnAmount,
			timestamp,
			hash
		);
		this.log.info(`Withdrew ${amount} BAN to "${banWallet} with txn ${hash}"`);
		return hash;
	}

	async swapToWBAN(
		from: string,
		amount: number,
		blockchainWallet: string,
		timestamp: number,
		signature: string
	): Promise<string> {
		return this.processingQueue.addSwapToWBan({
			from,
			amount,
			blockchainWallet,
			signature,
			timestamp,
		});
	}

	async processSwapToWBAN(swap: SwapBanToWBAN): Promise<any> {
		const { from, blockchainWallet, signature } = swap;
		const amountStr = swap.amount;
		// verify signature
		if (
			!this.checkSignature(
				blockchainWallet,
				signature,
				`Swap ${amountStr} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		) {
			throw new InvalidSignatureError();
		}
		// verify if there is a proper claim
		if (!(await this.usersDepositsService.hasClaim(from, blockchainWallet))) {
			throw new InvalidOwner();
		}

		const amount: BigNumber = ethers.utils.parseEther(amountStr.toString());

		// check for positive amounts
		if (amount.isNegative()) {
			throw new Error("Can't swap negative amounts of BAN");
		}

		// check if deposits are greater than or equal to amount to swap
		const availableBalance: BigNumber = await this.usersDepositsService.getUserAvailableBalance(
			from
		);
		if (!availableBalance.gte(amount)) {
			const message = `User "${from}" has not deposited enough BAN for a swap of ${amountStr} BAN. Deposited balance is: ${ethers.utils.formatEther(
				availableBalance
			)} BAN`;
			this.log.warn(message);
			throw new InsufficientBalanceError(message);
		}

		// create wBAN swap receipt
		const {
			receipt,
			uuid,
			wbanBalance,
		} = await this.blockchain.createMintReceipt(blockchainWallet, amount);
		// decrease user deposits
		// TODO: store signature?
		await this.usersDepositsService.storeUserSwapToWBan(
			from,
			blockchainWallet,
			amount,
			swap.timestamp,
			receipt,
			uuid
		);

		// if first wrap request, make a gasless transaction
		let gasless = false;
		let txnHash = "";
		const wrapCount = (
			await this.usersDepositsService.getSwaps(blockchainWallet, from)
		).length;
		if (
			this.relayerSigner &&
			wrapCount === 1 &&
			amountStr >= config.BlockchainGasLessBananoThreshold
		) {
			const cryptoBalance = await this.relayerSigner.provider.getBalance(
				blockchainWallet
			);
			const cryptoThreshold = ethers.utils.parseEther(
				config.BlockchainGasLessCryptoBalanceThreshold.toString()
			);
			if (cryptoBalance.lte(cryptoThreshold)) {
				this.log.info(
					`Gasless wrap from ${blockchainWallet} from ${amountStr} BAN with UUID ${uuid} and receipt ${receipt}`
				);
				gasless = true;
				// eslint-disable-next-line camelcase
				const wBAN = WBANTokenWithPermit__factory.connect(
					config.WBANContractAddress,
					this.relayerSigner
				);
				const sig: Signature = ethers.utils.splitSignature(receipt);
				const tx: any = await wBAN.mintWithReceipt(
					blockchainWallet,
					amount,
					uuid,
					sig.v,
					sig.r,
					sig.s
				);
				const relayedTx = await this.waitForRelayedTx(tx.transactionId);
				txnHash = relayedTx.hash;
			} else {
				this.log.warn(
					`Gasless wrap from ${blockchainWallet} ignored. Balance of ${ethers.utils.formatEther(
						cryptoBalance
					)} > ${ethers.utils.formatEther(cryptoThreshold)} ETH`
				);
			}
		}

		return { receipt, uuid, wbanBalance, gasless, txnHash };
	}

	async swapToBAN(swap: SwapWBANToBan): Promise<string> {
		return this.processingQueue.addSwapToBan(swap);
	}

	async processSwapToBAN(swap: SwapWBANToBan): Promise<any> {
		this.log.info(
			`Swapping ${swap.amount} wBAN to BAN (txn: ${swap.hash}) into wallet "${swap.banWallet}"...`
		);
		// check if the BAN were already sent
		if (await this.usersDepositsService.containsUserSwapToBan(swap)) {
			this.log.warn(`Swap for transaction "${swap.hash}" was already done.`);
			return {
				hash: swap.hash,
				wbanBalance: swap.wbanBalance,
			};
		}
		// add the amount to user deposits and store user swap from wBAN to BAN
		await this.usersDepositsService.storeUserSwapToBan(swap);
		return {
			hash: swap.hash,
			wbanBalance: swap.wbanBalance,
		};
	}

	async getHistory(
		blockchainWallet: string,
		banWallet: string
	): Promise<History> {
		const history = new History();
		history.deposits = await this.usersDepositsService.getDeposits(banWallet);
		history.withdrawals = await this.usersDepositsService.getWithdrawals(
			banWallet
		);
		history.swaps = await this.usersDepositsService.getSwaps(
			blockchainWallet,
			banWallet
		);
		return history;
	}

	async getPendingWithdrawalsAmount(): Promise<BigNumber> {
		return this.processingQueue.getPendingWithdrawalsAmount();
	}

	async gaslessSwap(banWallet: string, swap: GaslessSwap): Promise<void> {
		this.processingQueue.addGaslessSwap(banWallet, swap);
	}

	async processGaslessSwap(
		swap: GaslessSwap & { banWallet: string }
	): Promise<{ txnId: string; txnHash: string }> {
		if (!config.BlockchainRelayerEnabled || !this.relayerSigner) {
			this.log.warn("Relayer is turned off. Skipping gasless swap requests");
			throw new Error("Relayer is turned off. Skipping gasless swap requests");
		}
		const from = swap.recipient;
		if (!from) {
			this.log.warn("Missing address from transaction");
			throw new Error("Missing address from transaction");
		}
		// check user balance is below ETH threshold
		const cryptoBalance = await this.relayerSigner.provider.getBalance(from);
		const cryptoThreshold = ethers.utils.parseEther(
			config.BlockchainGasLessCryptoBalanceThreshold.toString()
		);
		if (cryptoBalance.gt(cryptoThreshold)) {
			this.log.warn(`Crypto balance of ${from} is above threshold`);
			throw new Error(`Crypto balance of ${from} is above threshold`);
		}
		// check if address is registered in the bridge
		if (!(await this.usersDepositsService.isClaimedFromETH(from))) {
			this.log.warn(`${from} is not registered in the bridge`);
			throw new Error(`${from} is not registered in the bridge`);
		}
		// check if free swap was already done
		if (await this.usersDepositsService.isFreeSwapAlreadyDone(swap.banWallet)) {
			this.log.warn(`${from} has already done a free swap`);
			throw new Error(`${from} has already done a free swap`);
		}
		// relay swap transaction
		const sig: Signature = ethers.utils.splitSignature(swap.permit.signature);
		const gaslessSwap = WBANGaslessSwap__factory.connect(
			config.WBANGaslessSwapAddress,
			this.relayerSigner
		);
		this.log.debug(`Gasless swap for ${swap.banWallet}/${from} for ${swap.permit.amount} wBAN with deadline ${swap.permit.deadline.toString()}...`);
		const tx: any = await gaslessSwap.swapWBANToCrypto(
			from,
			ethers.utils.parseEther(swap.permit.amount),
			BigNumber.from(swap.permit.deadline),
			sig.v,
			sig.r,
			sig.s,
			swap.swapCallData,
			{ gasLimit: swap.gasLimit + 300_000 }
		);
		const relayedTx = await this.waitForRelayedTx(tx.transactionId);
		// store free swap request
		await this.usersDepositsService.storeFreeSwap(swap.banWallet, tx.transactionId);
		return {
			txnId: tx.transactionId,
			txnHash: relayedTx.hash,
		};
	}

	checkSignature(
		blockchainWallet: string,
		signature: string,
		expected: string
	): boolean {
		this.log.trace(`Checking signature '${signature}'`);
		const author = ethers.utils.verifyMessage(expected, signature);
		const sanitizedAddress = ethers.utils.getAddress(blockchainWallet);
		if (author !== sanitizedAddress) {
			this.log.warn(
				`Signature is invalid. ${sanitizedAddress} sent a signed message pretending to be from ${author}`
			);
		}
		return author === sanitizedAddress;
	}

	private async waitForRelayedTx(txId: string): Promise<RelayerTransaction> {
		if (!config.BlockchainRelayerEnabled || !this.relayer || !this.relayerSigner) {
			throw new Error("Relayer is turned off");
		}
		await this.sleep(500);
		let tx = await this.relayer.query(txId);
		// poll the transaction status 'til it's either a succesfull or failed tx
		while (tx.status !== 'mined' && tx.status !== 'confirmed' && tx.status !== 'failed') {
			this.log.debug(`Waiting for relayed transaction ${txId} (tx hash: ${tx.hash}) to be confirmed...`);
			await this.sleep(500);
			tx = await this.relayer.query(txId);
		}
		const txReceipt = await this.relayerSigner.provider.getTransactionReceipt(tx.hash);
		// throw error if txn failed
		if (tx.status === 'failed' || txReceipt.status === 0) {
			throw new Error(`Could not relay swap transaction with ID ${txId} and hash ${tx.hash}`);
		}
		return tx;
	}

	private async eventuallySendBan(
		withdrawal: BananoUserWithdrawal
	): Promise<{ pending: boolean; hash?: string }> {
		const amountStr = withdrawal.amount;
		const amount: BigNumber = ethers.utils.parseEther(amountStr);
		// check if hot wallet balance is greater than or equal to amount to withdraw
		const hotWalletBalance: BigNumber = await this.banano.getBalance(
			config.BananoUsersDepositsHotWallet
		);
		if (hotWalletBalance.lt(amount)) {
			this.log.warn(
				`Hot wallet balance of ${ethers.utils.formatEther(
					hotWalletBalance
				)} BAN is not enough to proceed with a withdrawal of ${amountStr} BAN. Adding a pending withdrawal to queue.`
			);
			await this.processingQueue.addBananoUserPendingWithdrawal(withdrawal);
			return { pending: true };
		}
		// send the BAN to the user
		const hash = await this.banano.sendBan(withdrawal.banWallet, amount);
		return { pending: false, hash };
	}

	private withdrawalProcessor(
		signature?: string
	): Processor<BananoUserWithdrawal, any, string> {
		return async (job) => {
			const withdrawal: BananoUserWithdrawal = job.data;
			const hash = await this.processWithdrawBAN(withdrawal, signature);
			if (hash) {
				return {
					banWallet: withdrawal.banWallet,
					withdrawal: withdrawal.amount,
					balance: ethers.utils.formatEther(
						await this.usersDepositsService.getUserAvailableBalance(
							withdrawal.banWallet
						)
					),
					transaction: hash,
				};
			}
			if (withdrawal.attempt === 1) {
				return {
					banWallet: withdrawal.banWallet,
					withdrawal: withdrawal.amount,
					balance: ethers.utils.formatEther(
						await this.usersDepositsService.getUserAvailableBalance(
							withdrawal.banWallet
						)
					),
					transaction: "",
				};
			}
			// throw an error just to get the job as failed and removed as a new one was created instead
			throw new Error("Old pending withdrawal request replaced by a new one");
		};
	}
}

export { Service };

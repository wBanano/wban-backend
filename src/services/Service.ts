import { Logger } from "tslog";
import { BigNumber, ethers } from "ethers";
import { Processor } from "bullmq";
import { Banano } from "../Banano";
import config from "../config";
import { UsersDepositsService } from "./UsersDepositsService";
import InvalidSignatureError from "../errors/InvalidSignatureError";
import InvalidOwner from "../errors/InvalidOwner";
import InsufficientBalanceError from "../errors/InsufficientBalanceError";
import InsufficientHotWalletBalanceError from "../errors/InsufficientHotWalletBalanceError";
import { ClaimResponse } from "../models/responses/ClaimResponse";
import { BSC } from "../BSC";
import ProcessingQueue from "./queuing/ProcessingQueue";
import PendingWithdrawalsQueue from "./queuing/PendingWithdrawalsQueue";
import { OperationsNames } from "../models/operations/Operation";
import Withdrawal from "../models/operations/Withdrawal";
import BananoUserWithdrawal from "../models/operations/BananoUserWithdrawal";
import SwapBanToWBAN from "../models/operations/SwapBanToWBAN";
import SwapWBANToBan from "../models/operations/SwapWBANToBan";
import RepeatableQueue from "./queuing/RepeatableQueue";

class Service {
	banano: Banano;

	public bsc: BSC;

	private usersDepositsService: UsersDepositsService;

	private processingQueue: ProcessingQueue;

	private pendingWithdrawalsQueue: PendingWithdrawalsQueue;

	private repeatableQueue: RepeatableQueue;

	private log: Logger = config.Logger.getChildLogger();

	constructor(
		usersDepositsService: UsersDepositsService,
		processingQueue: ProcessingQueue,
		pendingWithdrawalsQueue: PendingWithdrawalsQueue,
		repeatableQueue: RepeatableQueue
	) {
		this.processingQueue = processingQueue;
		this.pendingWithdrawalsQueue = pendingWithdrawalsQueue;
		this.repeatableQueue = repeatableQueue;
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
				const processor = this.withdrawalProcessor(true, withdrawal.signature);
				return processor(job);
			}
		);
		this.processingQueue.registerProcessor(
			OperationsNames.SwapToWBAN,
			async (job) => {
				const swap: SwapBanToWBAN = job.data;
				const { hash, wbanBalance } = await this.processSwapToWBAN(swap);
				return {
					banWallet: swap.from,
					swapped: swap.amountStr,
					balance: ethers.utils.formatEther(
						await this.usersDepositsService.getUserAvailableBalance(swap.from)
					),
					wbanBalance: ethers.utils.formatEther(wbanBalance),
					transaction: hash,
					transactionLink: `${config.BinanceSmartChainBlockExplorerUrl}/tx/${hash}`,
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
					transactionLink: `${config.BinanceSmartChainBlockExplorerUrl}/tx/${hash}`,
				};
			}
		);
		this.pendingWithdrawalsQueue.registerProcessor(
			this.withdrawalProcessor(false)
		);
		this.bsc = new BSC(usersDepositsService, this.repeatableQueue);
		this.bsc.onSwapToBAN((swap: SwapWBANToBan) => this.swapToBAN(swap));
		this.usersDepositsService = usersDepositsService;
	}

	start(): void {
		this.processingQueue.start();
		this.pendingWithdrawalsQueue.start();
		this.repeatableQueue.start();
		this.banano.subscribeToBananoNotificationsForWallet();
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		return this.usersDepositsService.getUserAvailableBalance(from);
	}

	async claim(
		banWallet: string,
		bscWallet: string,
		signature: string
	): Promise<ClaimResponse> {
		// verify signature
		if (
			!this.checkSignature(
				bscWallet,
				signature,
				`I hereby claim that the BAN address "${banWallet}" is mine`
			)
		) {
			return ClaimResponse.InvalidSignature;
		}
		// check if the user already did the claim process
		if (await this.usersDepositsService.hasClaim(banWallet, bscWallet)) {
			return ClaimResponse.AlreadyDone;
		}
		// check if there is a pending claim
		if (!(await this.usersDepositsService.hasPendingClaim(banWallet))) {
			return (await this.usersDepositsService.storePendingClaim(
				banWallet,
				bscWallet
			))
				? ClaimResponse.Ok
				: ClaimResponse.Error;
		}
		// assume this is another use who tried to do this
		return ClaimResponse.InvalidOwner;
	}

	async withdrawBAN(
		banWallet: string,
		amount: string,
		bscWallet: string,
		date: Date,
		signature: string
	): Promise<string> {
		return this.processingQueue.addBananoUserWithdrawal({
			banWallet,
			amount,
			bscWallet,
			signature,
			date: date.toISOString(),
			checkUserBalance: true,
		});
	}

	async processWithdrawBAN(
		withdrawal: Withdrawal,
		queuePendingWithdrawals = true,
		signature?: string
	): Promise<string> {
		const { banWallet, amount, bscWallet, date } = withdrawal;

		this.log.info(
			`Processing user withdrawal request of "${amount}" BAN from wallet "${banWallet}"`
		);

		// check if request was already processed
		if (
			await this.usersDepositsService.containsUserWithdrawalRequest(withdrawal)
		) {
			this.log.warn(
				`User withdrawal request to "${banWallet}" at ${date} was already processed`
			);
			throw new Error(
				"Can't withdraw BAN as the transaction was already processed"
			);
		}

		// verify signature
		if (
			signature &&
			!this.checkSignature(
				bscWallet,
				signature,
				`Withdraw ${amount} BAN to my wallet "${banWallet}"`
			)
		) {
			throw new InvalidSignatureError();
		}

		if (!this.usersDepositsService.isClaimed(banWallet)) {
			throw new Error(`Can't withdraw from unclaimed wallet ${banWallet}`);
		} else if (!this.usersDepositsService.hasClaim(banWallet, bscWallet)) {
			throw new Error("Can't withdraw from another BSC wallet");
		}

		const withdrawnAmount: BigNumber = ethers.utils.parseEther(amount);

		if (withdrawal.checkUserBalance) {
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
		}

		// send the BAN to the user
		const { pending, hash } = await this.eventuallySendBan(
			withdrawal,
			queuePendingWithdrawals
		);

		if (pending) {
			return "";
		}

		// decrease user deposits
		if (withdrawal.checkUserBalance) {
			await this.usersDepositsService.storeUserWithdrawal(
				banWallet,
				withdrawnAmount,
				date
			);
		}
		this.log.info(`Withdrawed ${amount} BAN to "${banWallet}"`);
		return hash;
	}

	async swapToWBAN(
		from: string,
		amountStr: number,
		bscWallet: string,
		date: Date,
		signature: string
	): Promise<string> {
		return this.processingQueue.addSwapToWBan({
			from,
			amountStr,
			bscWallet,
			signature,
			date: date.toISOString(),
		});
	}

	async processSwapToWBAN(swap: SwapBanToWBAN): Promise<any> {
		const { from, amountStr, bscWallet, signature } = swap;
		// verify signature
		if (
			!this.checkSignature(
				bscWallet,
				signature,
				`Swap ${amountStr} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		) {
			throw new InvalidSignatureError();
		}
		// verify if there is a proper claim
		if (!(await this.usersDepositsService.hasClaim(from, bscWallet))) {
			throw new InvalidOwner();
		}

		const amount: BigNumber = ethers.utils.parseEther(amountStr.toString());

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

		// mint wBAN tokens
		const { hash, wbanBalance } = await this.bsc.mintTo(bscWallet, amount);
		// decrease user deposits
		// TODO: store signature?
		await this.usersDepositsService.storeUserSwap(from, amount, hash);
		return { hash, wbanBalance };
	}

	async swapToBAN(swap: SwapWBANToBan): Promise<string> {
		return this.processingQueue.addSwapToBan(swap);
	}

	async processSwapToBAN(swap: SwapWBANToBan): Promise<any> {
		this.log.info(
			`Swapping ${swap.amount} wBAN to BAN (txn: ${swap.hash}) into wallet "${swap.banWallet}"...`
		);
		// check if the BAN were already sent
		if (await this.usersDepositsService.swapToBanWasAlreadyDone(swap)) {
			this.log.warn(`Swap for transaction "${swap.hash}" was already done.`);
			return {
				hash: swap.hash,
				wbanBalance: swap.wbanBalance,
			};
		}
		// send the BAN to the user
		const { pending, hash } = await this.eventuallySendBan(swap, true);
		// store user swap from wBAN to BAN
		await this.usersDepositsService.swapToBan(swap);
		return {
			hash,
			wbanBalance: swap.wbanBalance,
		};
	}

	checkSignature(
		bscWallet: string,
		signature: string,
		expected: string
	): boolean {
		this.log.debug(`Checking signature '${signature}'`);
		const author = ethers.utils.verifyMessage(expected, signature);
		const sanitizedAddress = ethers.utils.getAddress(bscWallet);
		if (author !== sanitizedAddress) {
			this.log.warn(
				`Signature is invalid. ${sanitizedAddress} sent a signed message pretending to be from ${author}`
			);
		}
		return author === sanitizedAddress;
	}

	private async eventuallySendBan(
		withdrawal: Withdrawal,
		queuePendingWithdrawals = false
	): Promise<any> {
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
			if (queuePendingWithdrawals) {
				this.pendingWithdrawalsQueue.addPendingWithdrawal(withdrawal);
				return { pending: true };
			}
			throw new InsufficientHotWalletBalanceError(amount, hotWalletBalance);
		}
		// send the BAN to the user
		const hash = await this.banano.sendBan(withdrawal.banWallet, amount);
		return { pending: false, hash };
	}

	private withdrawalProcessor(
		enqueue: boolean,
		signature?: string
	): Processor<Withdrawal, any, string> {
		return async (job) => {
			const withdrawal: Withdrawal = job.data;
			const hash = await this.processWithdrawBAN(
				withdrawal,
				enqueue,
				signature
			);
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
				// eslint-disable-next-line no-else-return
			} else if (!enqueue) {
				throw new Error("Can't withdraw");
			} else {
				return "";
			}
		};
	}
}

export { Service };

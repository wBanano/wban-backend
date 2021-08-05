import { Queue, Processor, QueueScheduler, Job, QueueEvents } from "bullmq";
import { Logger } from "tslog";
import { ethers, BigNumber } from "ethers";
import { Operation, OperationsNames } from "../../models/operations/Operation";
import BananoUserDeposit from "../../models/operations/BananoUserDeposit";
import BananoUserWithdrawal from "../../models/operations/BananoUserWithdrawal";
import SwapBanToWBAN from "../../models/operations/SwapBanToWBAN";
import SwapWBANToBan from "../../models/operations/SwapWBANToBan";
import ProcessingQueue from "./ProcessingQueue";
import ProcessingQueueWorker from "./ProcessingQueueWorker";
import config from "../../config";
import JobListener from "./JobListener";

const QUEUE_NAME = "operations-queue";

class RedisProcessingQueue implements ProcessingQueue {
	private processingQueue: Queue<Operation, any, string>;

	private processingQueueEvents: QueueEvents;

	private worker: ProcessingQueueWorker;

	private queueScheduler: QueueScheduler;

	private jobListener: JobListener;

	public static PENDING_WITHDRAWAL_RETRY_DELAY = 1 * 60 * 1_000;

	private log: Logger = config.Logger.getChildLogger();

	public constructor() {
		this.processingQueue = new Queue(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
			defaultJobOptions: {
				timeout: 30_000,
				attempts: 3,
				backoff: {
					type: "exponential",
					delay: 1_000,
				},
				removeOnComplete: 100_000,
				removeOnFail: false,
			},
		});
		this.processingQueueEvents = new QueueEvents(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
		});
		this.worker = new ProcessingQueueWorker(QUEUE_NAME);
		this.worker.pause();
	}

	start(): void {
		this.worker.resume();
		this.queueScheduler = new QueueScheduler(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
		});
	}

	registerProcessor(jobName: OperationsNames, processor: Processor): void {
		this.worker.registerProcessorForJobNamed(jobName, processor);
	}

	addJobListener(listener: JobListener): void {
		this.worker.on("completed", async (job: Job) => {
			this.log.debug(
				`Job "${job.name}" (ID: ${job.id}) completed with: ${JSON.stringify(
					job.returnvalue
				)}`
			);
			// const job = await Job.fromId(this.processingQueue, jobId);
			this.log.trace(`Completed job: ${JSON.stringify(job)}`);
			listener.onJobCompleted(job.id, job.name, job.returnvalue);
		});
		this.worker.on("failed", async (job: Job) => {
			if (!job.id.startsWith("pending-")) {
				this.log.error(`Job "${job.name}" (ID: ${job.id}) failed`);
				this.log.error(`Failure reason is:\n${job.failedReason}`);
				this.log.error(`Stacktrace is:\n${job.stacktrace}`);
			}
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addBananoUserDeposit(deposit: BananoUserDeposit): Promise<any> {
		this.processingQueue.add(OperationsNames.BananoDeposit, deposit, {
			jobId: `${OperationsNames.BananoDeposit}-${deposit.sender}-${deposit.hash}`,
			timestamp: deposit.timestamp,
		});
		this.log.debug(`Added banano deposit to queue: ${JSON.stringify(deposit)}`);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addBananoUserWithdrawal(
		withdrawal: BananoUserWithdrawal
	): Promise<any> {
		this.processingQueue.add(OperationsNames.BananoWithdrawal, withdrawal, {
			jobId: `${OperationsNames.BananoWithdrawal}-${withdrawal.banWallet}-${withdrawal.timestamp}`,
			timestamp: withdrawal.timestamp,
		});
		this.log.debug(
			`Added banano withdrawal to queue: ${JSON.stringify(withdrawal)}`
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addBananoUserPendingWithdrawal(
		_withdrawal: BananoUserWithdrawal
	): Promise<any> {
		const withdrawal = _withdrawal;
		withdrawal.attempt = _withdrawal.attempt + 1;
		await this.processingQueue.add(
			OperationsNames.BananoWithdrawal,
			withdrawal,
			{
				jobId: `pending-${OperationsNames.BananoWithdrawal}-${withdrawal.banWallet}-${withdrawal.timestamp}-attempt-${withdrawal.attempt}`,
				delay:
					withdrawal.attempt *
					RedisProcessingQueue.PENDING_WITHDRAWAL_RETRY_DELAY,
				timestamp: withdrawal.timestamp,
				removeOnFail: true,
			}
		);
		this.log.debug(
			`Scheduled banano pending withdrawal attemp #${
				withdrawal.attempt
			} to queue: ${JSON.stringify(withdrawal)}`
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addSwapToWBan(swap: SwapBanToWBAN): Promise<any> {
		this.processingQueue.add(OperationsNames.SwapToWBAN, swap, {
			jobId: `${OperationsNames.SwapToWBAN}-${swap.from}-${swap.timestamp}`,
			timestamp: swap.timestamp,
		});
		this.log.debug(`Added swap BAN -> wBAN to queue: ${JSON.stringify(swap)}`);
	}

	async addSwapToBan(swap: SwapWBANToBan): Promise<any> {
		const job = await this.processingQueue.add(
			OperationsNames.SwapToBAN,
			swap,
			{
				jobId: `${OperationsNames.SwapToBAN}-${swap.blockchainWallet}-${swap.timestamp}`,
				timestamp: swap.timestamp,
			}
		);
		this.log.debug(
			`Added swap wBAN -> BAN to queue: '${job.id}' -- ${JSON.stringify(swap)}`
		);
	}

	async getPendingWithdrawalsAmount(): Promise<BigNumber> {
		// get waiting jobs
		const waitingJobs = await this.processingQueue.getWaiting(0, 1_000_000);
		const delayedJobs = await this.processingQueue.getDelayed(0, 1_000_000);
		const allJobs = waitingJobs.concat(delayedJobs);
		return (
			allJobs
				// safeguard for pending withdrawals, although we don't expect anything else
				.filter((job: Job) =>
					job.id.startsWith(`pending-${OperationsNames.BananoWithdrawal}`)
				)
				// extract withdrawal amount
				.map((job: Job) => {
					const withdrawal = job.data as BananoUserWithdrawal;
					return ethers.utils.parseEther(withdrawal.amount);
				})
				// sum all pending amounts
				.reduce(
					(acc: BigNumber, amount: BigNumber) => acc.add(amount),
					BigNumber.from(0)
				)
		);
	}
}

export default RedisProcessingQueue;

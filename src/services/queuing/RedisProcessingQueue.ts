import { Queue, Processor, QueueScheduler, Job, QueueEvents } from "bullmq";
import { Logger } from "tslog";
import cron from "node-cron";
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
				removeOnComplete: 100,
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
		cron.schedule("* * * * *", async () => {
			const {
				wait,
				active,
				delayed,
				failed,
			} = await this.processingQueue.getJobCounts(
				"wait",
				"active",
				"delayed",
				"failed"
			);
			this.log.debug(
				`Queue stats: active=${active}, waiting=${wait}, delayed=${delayed}, failed=${failed}`
			);
		});
	}

	registerProcessor(jobName: OperationsNames, processor: Processor): void {
		this.worker.registerProcessorForJobNamed(jobName, processor);
	}

	addJobListener(listener: JobListener): void {
		this.worker.on("completed", async (job: Job) => {
			this.log.info(
				`Job "${job.name}" (ID: ${job.id}) completed with: ${JSON.stringify(
					job.returnvalue
				)}`
			);
			// const job = await Job.fromId(this.processingQueue, jobId);
			this.log.info(`Completed job: ${JSON.stringify(job)}`);
			listener.onJobCompleted(job.id, job.name, job.returnvalue);
		});
		this.worker.on("failed", async (job: Job) => {
			this.log.error(`Job "${job.name}" (ID: ${job.id}) failed`);
			this.log.error(`Failure reason is:\n${job.failedReason}`);
			this.log.error(`Stacktrace is:\n${job.stacktrace}`);
		});
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addBananoUserDeposit(deposit: BananoUserDeposit): Promise<any> {
		this.processingQueue.add(OperationsNames.BananoDeposit, deposit, {
			jobId: `${OperationsNames.BananoDeposit}-${deposit.sender}-${deposit.hash}`,
		});
		this.log.debug(`Added banano deposit to queue: ${JSON.stringify(deposit)}`);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addBananoUserWithdrawal(
		withdrawal: BananoUserWithdrawal
	): Promise<any> {
		this.processingQueue.add(OperationsNames.BananoWithdrawal, withdrawal, {
			jobId: `${OperationsNames.BananoWithdrawal}-${withdrawal.banWallet}-${withdrawal.date}`,
		});
		this.log.debug(
			`Added banano withdrawal to queue: ${JSON.stringify(withdrawal)}`
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	async addSwapToWBan(swap: SwapBanToWBAN): Promise<any> {
		this.processingQueue.add(OperationsNames.SwapToWBAN, swap, {
			jobId: `${OperationsNames.SwapToWBAN}-${swap.from}-${swap.date}`,
		});
		this.log.debug(`Added swap BAN -> wBAN to queue: ${JSON.stringify(swap)}`);
	}

	async addSwapToBan(swap: SwapWBANToBan): Promise<any> {
		this.processingQueue.add(OperationsNames.SwapToBAN, swap, {
			jobId: `${OperationsNames.SwapToBAN}-${swap.bscWallet}-${swap.date}`,
		});
		this.log.debug(`Added swap wBAN -> BAN to queue: ${JSON.stringify(swap)}`);
	}
}

export default RedisProcessingQueue;
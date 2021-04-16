import {
	Queue,
	Worker,
	Processor,
	Job,
	QueueScheduler,
	QueueEvents,
} from "bullmq";
import { Logger } from "tslog";
import cron from "node-cron";
import Withdrawal from "../../models/operations/Withdrawal";
import PendingWithdrawalsQueue from "./PendingWithdrawalsQueue";
import InsufficientHotWalletBalanceError from "../../errors/InsufficientHotWalletBalanceError";
import config from "../../config";
import JobListener from "./JobListener";

const QUEUE_NAME = "pending-withdrawals-queue";

class RedisPendingWithdrawalsQueue implements PendingWithdrawalsQueue {
	private pendingWithdrawalsQueue: Queue<Withdrawal, any, string>;

	private pendingWithdrawalsQueueEvents: QueueEvents;

	private queueScheduler: QueueScheduler;

	private processor: Processor;

	private log: Logger = config.Logger.getChildLogger();

	public constructor() {
		this.pendingWithdrawalsQueue = new Queue(QUEUE_NAME, {
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
		this.pendingWithdrawalsQueueEvents = new QueueEvents(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
		});
	}

	start(): void {
		this.queueScheduler = new QueueScheduler(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
		});
		cron.schedule("* * * * *", async () => {
			const worker = new Worker(QUEUE_NAME, null, {
				connection: {
					host: config.RedisHost,
				},
			});
			await this.monitorPendingWithdrawals(worker);
			worker.close();
		});
		cron.schedule("* * * * *", async () => {
			const {
				wait,
				active,
				delayed,
				failed,
			} = await this.pendingWithdrawalsQueue.getJobCounts(
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

	registerProcessor(processor: Processor<Withdrawal, any, string>): void {
		this.processor = processor;
		this.log.debug("Registered new processor");
	}

	addJobListener(listener: JobListener): void {
		this.pendingWithdrawalsQueueEvents.on("completed", async (event: any) => {
			this.log.debug(`Got: ${JSON.stringify(event)}`);
			const { jobId } = event;
			this.log.debug(`Searching for completed job with ID ${jobId}...`);
			const job = await this.pendingWithdrawalsQueue.getJob(jobId);
			this.log.debug(JSON.stringify(job));
			this.log.info(
				`Job "${job.name}" (ID: ${job.id}) completed with: ${JSON.stringify(
					job.returnvalue
				)}`
			);
			// const job = await Job.fromId(this.processingQueue, jobId);
			this.log.info(`Completed job: ${JSON.stringify(job)}`);
			listener.onJobCompleted(job.id, job.name, job.returnvalue);
		});
		this.pendingWithdrawalsQueueEvents.on("failed", async (job: Job) => {
			this.log.error(`Job "${job.name}" (ID: ${job.id}) failed`);
			this.log.error(`Failure reason is:\n${job.failedReason}`);
			this.log.error(`Stacktrace is:\n${job.stacktrace}`);
		});
	}

	async addPendingWithdrawal(withdrawal: Withdrawal): Promise<any> {
		this.pendingWithdrawalsQueue.add("pending-withdrawal", withdrawal, {
			delay: 30_000,
		});
		this.log.debug(
			`Added banano withdrawal to queue: ${JSON.stringify(withdrawal)}`
		);
	}

	private async monitorPendingWithdrawals(worker: Worker): Promise<void> {
		/* eslint-disable-next-line no-await-in-loop */
		this.log.debug("Waiting for new pending withdrawals");
		const job: Job | void = await worker.getNextJob(QUEUE_NAME);
		if (!job) {
			return;
		}
		this.log.debug(`Got pending withdrawal job ${JSON.stringify(job)}`);
		try {
			const result = await this.processor(job);
			this.log.debug("Processed job");
			await job.moveToCompleted(result, QUEUE_NAME);
		} catch (err) {
			if (err instanceof InsufficientHotWalletBalanceError) {
				this.log.debug("Still can make the withdrawal. Delaying...");
				await job.moveToDelayed(Date.now() + 10_000);
			} else {
				this.log.debug("Job in error");
				await job.moveToFailed(err, QUEUE_NAME);
			}
		}
	}
}

export default RedisPendingWithdrawalsQueue;

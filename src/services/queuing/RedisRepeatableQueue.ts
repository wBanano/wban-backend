import { Queue, Processor, QueueScheduler } from "bullmq";
import { Logger } from "tslog";
import RepeatableQueue from "./RepeatableQueue";
import ProcessingQueueWorker from "./ProcessingQueueWorker";
import config from "../../config";

const QUEUE_NAME = "repeatable-queue";

class RedisRepeatableQueue implements RepeatableQueue {
	private queue: Queue<any, any, string>;

	private worker: ProcessingQueueWorker;

	private queueScheduler: QueueScheduler;

	private log: Logger = config.Logger.getChildLogger();

	public constructor() {
		this.queue = new Queue(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
			defaultJobOptions: {
				timeout: 10_000,
				attempts: 3,
				backoff: {
					type: "exponential",
					delay: 1_000,
				},
				removeOnComplete: 100_000,
				removeOnFail: false,
			},
		});
		this.queueScheduler = new QueueScheduler(QUEUE_NAME, {
			connection: {
				host: config.RedisHost,
			},
		});
		this.worker = new ProcessingQueueWorker(QUEUE_NAME);
		this.queue.pause();
	}

	start(): void {
		this.queue.resume();
	}

	registerProcessor(jobName: string, processor: Processor): void {
		this.worker.registerProcessorForJobNamed(jobName, processor);
	}

	async scheduleCronJob(jobName: string, cron: string): Promise<any> {
		return this.queue.add(
			jobName,
			// no job data
			{},
			{
				repeat: {
					cron,
				},
			}
		);
	}

	async schedulePeriodicJob(jobName: string, every: number): Promise<any> {
		return this.queue.add(
			jobName,
			// no job data
			{},
			{
				repeat: {
					every,
				},
			}
		);
	}
}

export default RedisRepeatableQueue;

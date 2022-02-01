import { Worker, Job, Processor } from "bullmq";
import { Logger } from "tslog";
import config from "../../config";

class ProcessingQueueWorker extends Worker<any, any, string> {
	private processors: Map<string, Processor>;

	private log: Logger = config.Logger.getChildLogger();

	public constructor(queueName: string, concurrency = 1) {
		super(queueName, async (job) => this.processQueueItem(job), {
			// disable concurrency
			concurrency,
			connection: {
				host: config.RedisHost,
			},
		});
		this.processors = new Map();
		this.log.debug(
			`Queue "${queueName}" created with a concurrency of ${concurrency}`
		);
	}

	async processQueueItem(job: Job): Promise<string> {
		const processor: Processor | undefined = this.processors.get(job.name);
		if (!processor) {
			this.log.error(`Can't find a processor for jobs named "${job.name}"`);
			throw new Error(`Can't find a processor for jobs named "${job.name}"`);
		}
		// eslint-disable-next-line consistent-return
		return processor(job);
	}

	registerProcessorForJobNamed(jobName: string, processor: Processor): void {
		this.processors.set(jobName, processor);
		this.log.debug(`Registered new processor for jobs named "${jobName}"`);
	}
}

export default ProcessingQueueWorker;

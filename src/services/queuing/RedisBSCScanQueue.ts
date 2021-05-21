import { Queue, Processor, QueueScheduler, Job } from "bullmq";
import { Logger } from "tslog";
import { ethers } from "ethers";
import BSCScanQueue from "./BSCScanQueue";
import ProcessingQueueWorker from "./ProcessingQueueWorker";
import config from "../../config";
import { UsersDepositsService } from "../UsersDepositsService";

const QUEUE_NAME = "bsc-scan";

class RedisBSCScanQueue implements BSCScanQueue {
	private queue: Queue<any, any, string>;

	private worker: ProcessingQueueWorker;

	private queueScheduler: QueueScheduler;

	private log: Logger = config.Logger.getChildLogger();

	public constructor(usersDepositsService: UsersDepositsService) {
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
		const provider = new ethers.providers.JsonRpcProvider(
			config.BinanceSmartChainJsonRpc,
			{
				name: config.BinanceSmartChainNetworkName,
				chainId: config.BinanceSmartChainNetworkChainId,
			}
		);
		this.worker.registerProcessorForJobNamed("bsc-scan-repeat", async () => {
			const latestBlockProcessed: number = await usersDepositsService.getLastBSCBlockProcessed();
			const currentBlock: number = await provider.getBlockNumber();
			this.queue.add(
				"bsc-scan",
				{
					blockFrom: latestBlockProcessed + 1,
					blockTo: currentBlock,
				},
				{
					jobId: `${latestBlockProcessed + 1}-${currentBlock}`,
				}
			);
		});
		this.queue.pause();
	}

	start(): void {
		this.schedulePeriodicJob("bsc-scan-repeat", 30_000);
		this.queue.resume();
	}

	registerProcessor(jobName: string, processor: Processor): void {
		this.worker.registerProcessorForJobNamed(jobName, processor);
	}

	private async schedulePeriodicJob(
		jobName: string,
		every: number
	): Promise<any> {
		return this.queue.add(
			jobName,
			// no job data
			{},
			{
				repeat: {
					every,
				},
				removeOnComplete: true,
				removeOnFail: true,
			}
		);
	}
}

export default RedisBSCScanQueue;

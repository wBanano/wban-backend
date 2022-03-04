import { Queue, Processor, QueueScheduler, Job } from "bullmq";
import { Logger } from "tslog";
import { ethers } from "ethers";
import BlockchainScanQueue from "./BlockchainScanQueue";
import ProcessingQueueWorker from "./ProcessingQueueWorker";
import config from "../../config";
import { UsersDepositsService } from "../UsersDepositsService";

const QUEUE_NAME = "bc-scan";

class RedisBlockchainScanQueue implements BlockchainScanQueue {
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
				timeout: 20_000,
				attempts: 3,
				backoff: {
					type: "exponential",
					delay: 1_000,
				},
				removeOnComplete: 30_000,
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
			config.BlockchainJsonRpc,
			{
				name: config.BlockchainNetworkName,
				chainId: config.BlockchainNetworkChainId,
			}
		);
		this.worker.registerProcessorForJobNamed("bc-scan-repeat", async () => {
			const latestBlockProcessed: number = await usersDepositsService.getLastBlockchainBlockProcessed();
			const currentBlock: number = await provider.getBlockNumber();
			this.queue.add(
				"bc-scan",
				{
					blockFrom: latestBlockProcessed + 1,
					blockTo: Math.min(latestBlockProcessed + 10_000, currentBlock),
				},
				{
					jobId: `${latestBlockProcessed + 1}-${currentBlock}`,
				}
			);
		});
		this.queue.pause();
	}

	start(): void {
		this.schedulePeriodicJob("bc-scan-repeat", 30_000);
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

export default RedisBlockchainScanQueue;

import { Processor } from "bullmq";

interface BlockchainScanQueue {
	start(): void;
	registerProcessor(jobName: string, processor: Processor): void;
}

export default BlockchainScanQueue;

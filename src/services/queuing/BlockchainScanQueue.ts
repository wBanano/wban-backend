import { Processor } from "bullmq";

interface BlockchainScanQueue {
	start(): void;
	stop(): Promise<void>;
	registerProcessor(jobName: string, processor: Processor): void;
}

export default BlockchainScanQueue;

import { Processor } from "bullmq";

interface BSCScanQueue {
	start(): void;
	registerProcessor(jobName: string, processor: Processor): void;
}

export default BSCScanQueue;

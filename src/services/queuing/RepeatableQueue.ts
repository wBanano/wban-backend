import { Processor } from "bullmq";

interface RepeatableQueue {
	start(): void;
	registerProcessor(jobName: string, processor: Processor): void;
	scheduleCronJob(jobName: string, cron: string): Promise<any>;
	schedulePeriodicJob(jobName: string, every: number): Promise<any>;
}

export default RepeatableQueue;

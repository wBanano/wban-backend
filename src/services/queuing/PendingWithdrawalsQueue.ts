import { Processor } from "bullmq";
import Withdrawal from "../../models/operations/Withdrawal";
import JobListener from "./JobListener";

interface PendingWithdrawalsQueue {
	start(): void;
	registerProcessor(processor: Processor<Withdrawal, any, string>): void;
	addJobListener(listener: JobListener): void;

	addPendingWithdrawal(withdrawal: Withdrawal): Promise<any>;
}

export default PendingWithdrawalsQueue;

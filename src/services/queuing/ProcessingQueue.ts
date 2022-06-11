import { Processor } from "bullmq";
import { BigNumber } from "ethers";
import JobListener from "./JobListener";
import { OperationsNames } from "../../models/operations/Operation";
import BananoUserDeposit from "../../models/operations/BananoUserDeposit";
import BananoUserWithdrawal from "../../models/operations/BananoUserWithdrawal";
import SwapBanToWBAN from "../../models/operations/SwapBanToWBAN";
import SwapWBANToBan from "../../models/operations/SwapWBANToBan";
import GaslessSwap from "../../models/operations/GaslessSwap";

interface ProcessingQueue {
	start(): void;
	registerProcessor(jobName: OperationsNames, processor: Processor): void;
	addJobListener(listener: JobListener): void;

	addBananoUserDeposit(deposit: BananoUserDeposit): Promise<any>;
	addBananoUserWithdrawal(withdrawal: BananoUserWithdrawal): Promise<any>;
	addBananoUserPendingWithdrawal(
		withdrawal: BananoUserWithdrawal
	): Promise<any>;

	addSwapToWBan(swap: SwapBanToWBAN): Promise<string>;
	addSwapToBan(swap: SwapWBANToBan): Promise<string>;

	addGaslessSwap(banWallet: string, swap: GaslessSwap): Promise<void>;

	getPendingWithdrawalsAmount(): Promise<BigNumber>;
}

export default ProcessingQueue;

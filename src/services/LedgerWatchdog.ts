import { Logger } from "tslog";
import { ethers } from "ethers";
import config from "../config";
import { LedgerHealth } from "../storage/postgres/LedgerHealth";

const CHECK_INTERVAL_MS = 60_000;

class LedgerWatchdog {
	private health: LedgerHealth;

	private timer: NodeJS.Timeout | undefined;

	private log: Logger = config.Logger.getChildLogger();

	constructor(health: LedgerHealth) {
		this.health = health;
	}

	start(): void {
		this.check();
		this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
		this.timer.unref();
	}

	stop(): void {
		clearInterval(this.timer);
	}

	async check(): Promise<void> {
		try {
			const { stuckWithdrawals, balanceMismatches } =
				await this.health.report();
			stuckWithdrawals.forEach((withdrawal) =>
				this.log.error(
					`Withdrawal ${withdrawal.id} of ${ethers.utils.formatEther(
						withdrawal.amount
					)} BAN to ${
						withdrawal.banAddress
					} is reserved since ${withdrawal.reservedAt.toISOString()}, resolve it with yarn ledger:withdrawal`
				)
			);
			balanceMismatches.forEach((mismatch) =>
				this.log.error(
					`Balance of ${mismatch.banAddress} is ${mismatch.balance}, its ledger entries add up to ${mismatch.expected}`
				)
			);
		} catch (err) {
			this.log.error("Couldn't check the ledger health", err);
		}
	}
}

export default LedgerWatchdog;

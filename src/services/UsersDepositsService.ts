import { Logger } from "tslog";
import { ethers, BigNumber } from "ethers";
import config from "../config";
import { UsersDepositsStorage } from "../storage/UsersDepositsStorage";

class UsersDepositsService {
	private usersDepositsStorage: UsersDepositsStorage;

	private log: Logger = config.Logger.getChildLogger();

	constructor(usersDepositsStorage: UsersDepositsStorage) {
		this.usersDepositsStorage = usersDepositsStorage;
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		const balance = await this.usersDepositsStorage.getUserAvailableBalance(
			from
		);
		this.log.info(
			`User ${from} has an available balance of ${ethers.utils.formatUnits(
				balance
			)} BAN`
		);
		return balance;
	}

	async storeUserDeposit(
		from: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		// check if the transaction wasn't already ingested!
		if (await this.usersDepositsStorage.containsTransaction(from, hash)) {
			this.log.warn(
				`Transaction ${hash} from ${from} was already processed. Skipping it...`
			);
			return;
		}
		// store the user deposit
		this.usersDepositsStorage.storeUserDeposit(from, amount, hash);
	}

	async storeUserSwap(from: string, amount: BigNumber): Promise<void> {
		return this.usersDepositsStorage.storeUserSwap(from, amount);
	}
}

export { UsersDepositsService };

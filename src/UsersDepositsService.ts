import { Logger } from "tslog";
import BigNumber from "@bananocoin/bananojs";
import { UsersDepositsStorage } from "./UsersDepositsStorage";

class UsersDepositsService {
	private usersDepositsStorage: UsersDepositsStorage;

	private log: Logger = new Logger();

	constructor(usersDepositsStorage: UsersDepositsStorage) {
		this.usersDepositsStorage = usersDepositsStorage;
	}

	async getUserAvailableBalance(from: string): Promise<number> {
		return this.usersDepositsStorage.getUserAvailableBalance(from);
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

	async storeUserSwap(from: string, amount: number): Promise<void> {
		return this.usersDepositsStorage.storeUserSwap(from, amount);
	}
}

export { UsersDepositsService };

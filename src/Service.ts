import { Logger } from "tslog";
import { Banano } from "./Banano";
import config from "./config";
import { UsersDepositsStorage } from "./UsersDepositsStorage";

class Service {
	private banano: Banano;

	private usersDepositsStorage: UsersDepositsStorage;

	private log: Logger = new Logger();

	constructor(usersDepositsStorage: UsersDepositsStorage) {
		this.banano = new Banano(
			config.BananoUsersDepositsWallet,
			usersDepositsStorage
		);
		this.usersDepositsStorage = usersDepositsStorage;
	}

	async start(): Promise<void> {
		await this.banano.subscribeToBananoNotificationsForWallet();
	}

	async getUserAvailableBalance(from: string): Promise<number> {
		return this.usersDepositsStorage.getUserAvailableBalance(from);
	}

	async swap(
		from: string,
		amount: number,
		signature: string
	): Promise<boolean> {
		// TODO: verify signature
		this.log.debug(`TODO: Checking signature '${signature}'`);
		// TODO: check if deposits are greater than or equal to amount to swap
		const availableBalance: number = await this.usersDepositsStorage.getUserAvailableBalance(
			from
		);
		if (availableBalance < amount) {
			return false;
		}

		// decrease user deposits
		await this.usersDepositsStorage.storeUserSwap(from, amount);
		// TODO: mint wBAN tokens
		return true;
	}
}

export { Service };

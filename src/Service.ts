import { Banano } from "./Banano";
import config from "./config";
import { UsersDepositsStorage } from "./UsersDepositsStorage";

class Service {
	private banano: Banano;

	private usersDepositsStorage: UsersDepositsStorage;

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
}

export { Service };

import { Logger } from "tslog";
import { Banano } from "./Banano";
import config from "./config";
import { UsersDepositsService } from "./UsersDepositsService";

class Service {
	private banano: Banano;

	private usersDepositsService: UsersDepositsService;

	private log: Logger = new Logger();

	constructor(usersDepositsService: UsersDepositsService) {
		this.banano = new Banano(
			config.BananoUsersDepositsWallet,
			usersDepositsService
		);
		this.usersDepositsService = usersDepositsService;
	}

	async start(): Promise<void> {
		await this.banano.subscribeToBananoNotificationsForWallet();
	}

	async getUserAvailableBalance(from: string): Promise<number> {
		return this.usersDepositsService.getUserAvailableBalance(from);
	}

	async swap(
		from: string,
		amount: number,
		signature: string
	): Promise<boolean> {
		// TODO: verify signature
		this.log.debug(`TODO: Checking signature '${signature}'`);
		// TODO: check if deposits are greater than or equal to amount to swap
		const availableBalance: number = await this.usersDepositsService.getUserAvailableBalance(
			from
		);
		if (availableBalance < amount) {
			return false;
		}

		// decrease user deposits
		await this.usersDepositsService.storeUserSwap(from, amount);
		// TODO: mint wBAN tokens
		return true;
	}
}

export { Service };

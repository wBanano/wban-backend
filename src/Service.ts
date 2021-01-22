import { Logger } from "tslog";
import { ethers } from "ethers";
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
		bscWallet: string,
		signature: string
	): Promise<boolean> {
		// verify signature
		if (!this.checkSignature(from, amount, bscWallet, signature)) {
			return false;
		}
		// TODO: store signature?

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

	checkSignature(
		from: string,
		amount: number,
		bscWallet: string,
		signature: string
	): boolean {
		this.log.debug(`Checking signature '${signature}'`);
		const author = ethers.utils.verifyMessage(
			`Swap ${amount} BAN for wBAN with BAN I deposited from my wallet "${from}"`,
			signature
		);
		const sanitizedAddress = ethers.utils.getAddress(bscWallet);
		if (author !== sanitizedAddress) {
			this.log.warn(
				`Signature is invalid. ${author} sent a signed message pretending to be from ${sanitizedAddress}`
			);
		}
		return author === sanitizedAddress;
	}
}

export { Service };

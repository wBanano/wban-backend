import { Logger } from "tslog";
import { BigNumber, ethers } from "ethers";
import { Banano } from "../Banano";
import config from "../config";
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

	start(): void {
		this.banano.subscribeToBananoNotificationsForWallet();
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		return this.usersDepositsService.getUserAvailableBalance(from);
	}

	async swap(
		from: string,
		amountStr: string,
		bscWallet: string,
		signature: string
	): Promise<boolean> {
		// verify signature
		if (!this.checkSignature(from, amountStr, bscWallet, signature)) {
			return false;
		}
		// TODO: store signature?

		const amount: BigNumber = ethers.utils.parseEther(amountStr);

		// TODO: check if deposits are greater than or equal to amount to swap
		const availableBalance: BigNumber = await this.usersDepositsService.getUserAvailableBalance(
			from
		);
		if (amount.lte(availableBalance)) {
			this.log.warn(
				`User ${from} has not deposited enough BAN for a swap of ${amount}. Deposited balance is: ${availableBalance}`
			);
			return false;
		}

		// decrease user deposits
		await this.usersDepositsService.storeUserSwap(from, amount);
		// TODO: mint wBAN tokens
		return true;
	}

	checkSignature(
		from: string,
		amount: string,
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
				`Signature is invalid. ${sanitizedAddress} sent a signed message pretending to be from ${author}`
			);
		}
		return author === sanitizedAddress;
	}
}

export { Service };

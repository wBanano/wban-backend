import { Logger } from "tslog";
import { BigNumber, ethers } from "ethers";
import { Banano } from "../Banano";
import config from "../config";
import { UsersDepositsService } from "./UsersDepositsService";
import InvalidSignatureError from "../errors/InvalidSignatureError";
import InsufficientBalanceError from "../errors/InsufficientBalanceError";
import { BSC } from "../BSC";

class Service {
	private banano: Banano;

	private bsc: BSC;

	private usersDepositsService: UsersDepositsService;

	private log: Logger = config.Logger.getChildLogger();

	constructor(usersDepositsService: UsersDepositsService) {
		this.banano = new Banano(
			config.BananoUsersDepositsWallet,
			config.BananoSeed,
			config.BananoSeedIdx,
			config.BananoRepresentative,
			usersDepositsService
		);
		this.bsc = new BSC();
		this.usersDepositsService = usersDepositsService;
	}

	start(): void {
		this.banano.subscribeToBananoNotificationsForWallet();
	}

	async getUserAvailableBalance(from: string): Promise<BigNumber> {
		return this.usersDepositsService.getUserAvailableBalance(from);
	}

	async claim(
		banWallet: string,
		bscWallet: string,
		signature: string
	): Promise<boolean> {
		// verify signature
		if (
			!this.checkSignature(
				bscWallet,
				signature,
				`I hereby claim that the BAN address "${banWallet}" is mine`
			)
		) {
			return false;
		}
		return this.usersDepositsService.storePendingClaim(banWallet, bscWallet);
	}

	async swap(
		from: string,
		amountStr: number,
		bscWallet: string,
		signature: string
	): Promise<void> {
		// verify signature
		if (
			!this.checkSignature(
				bscWallet,
				signature,
				`Swap ${amountStr} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		) {
			throw new InvalidSignatureError();
		}

		const amount: BigNumber = ethers.utils.parseEther(amountStr.toString());

		// TODO: check if deposits are greater than or equal to amount to swap
		const availableBalance: BigNumber = await this.usersDepositsService.getUserAvailableBalance(
			from
		);
		if (!availableBalance.gte(amount)) {
			this.log.warn(
				`User ${from} has not deposited enough BAN for a swap of ${amount}. Deposited balance is: ${availableBalance}`
			);
			throw new InsufficientBalanceError();
		}

		try {
			// lock user balance to prevent other concurrent swaps
			await this.usersDepositsService.lockBalance(from);
			// mint wBAN tokens
			const hash = await this.bsc.mintTo(bscWallet, amount);
			// decrease user deposits
			// TODO: store signature?
			await this.usersDepositsService.storeUserSwap(from, amount, hash);
		} finally {
			// unlock user balance
			await this.usersDepositsService.unlockBalance(from);
		}
	}

	checkSignature(
		bscWallet: string,
		signature: string,
		expected: string
	): boolean {
		this.log.debug(`Checking signature '${signature}'`);
		const author = ethers.utils.verifyMessage(expected, signature);
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

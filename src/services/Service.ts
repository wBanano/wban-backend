import { Logger } from "tslog";
import { BigNumber, ethers } from "ethers";
import SwapToBanEvent from "../models/events/SwapToBanEvent";
import { Banano } from "../Banano";
import config from "../config";
import { UsersDepositsService } from "./UsersDepositsService";
import InvalidSignatureError from "../errors/InvalidSignatureError";
import InsufficientBalanceError from "../errors/InsufficientBalanceError";
import { ClaimResponse } from "../models/responses/ClaimResponse";
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
		this.bsc = new BSC(usersDepositsService);
		this.bsc.onSwapToBan((event: SwapToBanEvent) => this.swapToBan(event));
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
	): Promise<ClaimResponse> {
		// verify signature
		if (
			!this.checkSignature(
				bscWallet,
				signature,
				`I hereby claim that the BAN address "${banWallet}" is mine`
			)
		) {
			return ClaimResponse.InvalidSignature;
		}
		// check if the user already did the claim process
		if (await this.usersDepositsService.hasClaim(banWallet, bscWallet)) {
			return ClaimResponse.AlreadyDone;
		}
		// check if there is a pending claim
		if (await this.usersDepositsService.hasPendingClaim(banWallet)) {
			return (await this.usersDepositsService.storePendingClaim(
				banWallet,
				bscWallet
			))
				? ClaimResponse.Ok
				: ClaimResponse.Error;
		}
		// assume this is another use who tried to do this
		return ClaimResponse.InvalidOwner;
	}

	async swap(
		from: string,
		amountStr: number,
		bscWallet: string,
		signature: string
	): Promise<string> {
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

		// check if deposits are greater than or equal to amount to swap
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
			return hash;
		} finally {
			// unlock user balance
			await this.usersDepositsService.unlockBalance(from);
		}
	}

	async withdrawBAN(
		to: string,
		amountStr: number,
		bscWallet: string,
		signature: string
	): Promise<string> {
		// verify signature
		if (
			!this.checkSignature(
				bscWallet,
				signature,
				`Withdraw ${amountStr} BAN to my wallet "${to}"`
			)
		) {
			throw new InvalidSignatureError();
		}

		if (!this.usersDepositsService.isClaimed(to)) {
			throw new Error(`Can't withdraw from unclaimed wallet ${to}`);
		} else if (!this.usersDepositsService.hasClaim(to, bscWallet)) {
			throw new Error("Can't withdraw from another BSC wallet");
		}

		const amount: BigNumber = ethers.utils.parseEther(amountStr.toString());

		// check if deposits are greater than or equal to amount to swap
		const availableBalance: BigNumber = await this.usersDepositsService.getUserAvailableBalance(
			to
		);
		if (!availableBalance.gte(amount)) {
			this.log.warn(
				`User ${to} has not deposited enough BAN for a withdrawal of ${amount}. Deposited balance is: ${availableBalance}`
			);
			throw new InsufficientBalanceError();
		}

		try {
			// lock user balance to prevent other concurrent swaps
			await this.usersDepositsService.lockBalance(to);
			// send the BAN to the user
			const hash = await this.banano.sendBan(to, amount);
			// decrease user deposits
			// TODO: store signature?
			await this.usersDepositsService.storeUserWithdrawal(
				to,
				amount,
				signature
			);
			return hash;
		} finally {
			// unlock user balance
			await this.usersDepositsService.unlockBalance(to);
		}
	}

	async swapToBan(event: SwapToBanEvent): Promise<void> {
		try {
			// check if the BAN were already sent
			if (await this.usersDepositsService.swapToBanWasAlreadyDone(event)) {
				this.log.warn(`Swap for ${event.hash} was already done.`);
				return;
			}
			// send the BAN to the user
			await this.banano.sendBan(event.banAddress, event.amount);
			// store user swap from wBAN to BAN
			await this.usersDepositsService.swapToBan(event);
		} catch (err) {
			this.log.error("Couldn't send BAN", err);
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

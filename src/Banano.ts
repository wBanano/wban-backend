import * as banano from "@bananocoin/bananojs";
import * as WS from "websocket";
import { Logger } from "tslog";
import cron from "node-cron";
import { ethers, BigNumber } from "ethers";
import { Mutex } from "async-mutex";
import { UsersDepositsService } from "./services/UsersDepositsService";
import config from "./config";

const BANANO_API_URL = "https://kaliumapi.appditto.com/api";

class Banano {
	private usersDepositsWallet: string;

	private seed: string;

	private seedIdx: number;

	private representative: string;

	private usersDepositsService: UsersDepositsService;

	private ws: WS.client;

	private mutex: Mutex;

	private log: Logger = config.Logger.getChildLogger();

	constructor(
		usersDepositsWallet: string,
		seed: string,
		seedIdx: number,
		representative: string,
		usersDepositsService: UsersDepositsService
	) {
		this.usersDepositsWallet = usersDepositsWallet;
		this.usersDepositsService = usersDepositsService;
		this.seed = seed;
		this.seedIdx = seedIdx;
		this.representative = representative;
		this.mutex = new Mutex();

		banano.setBananodeApiUrl(BANANO_API_URL); // TODO: try to connect to local node instead!
		// check every 5 miinutes if transactions were missed from the WebSockets API
		if (config.BananoPendingTransactionsThreadEnabled === true) {
			cron.schedule("*/5 * * * *", () => {
				this.processPendingTransactions(usersDepositsWallet);
			});
		} else {
			this.log.warn(
				"Ignoring checks of pending transactions. Only do this for running tests!"
			);
		}
	}

	async sendBan(banAddress: string, amount: BigNumber): Promise<void> {
		await this.mutex.runExclusive(async () => {
			this.log.debug(
				`Sending ${ethers.utils.formatEther(amount)} BAN to ${banAddress}`
			);
			return banano.sendBananoWithdrawalFromSeed(
				this.seed,
				this.seedIdx,
				banAddress,
				ethers.utils.formatEther(amount)
			);
		});
	}

	async subscribeToBananoNotificationsForWallet(): Promise<void> {
		this.log.info(
			`Subscribing to wallet notifications for '${this.usersDepositsWallet}'...`
		);
		// eslint-disable-next-line new-cap
		this.ws = new WS.client();
		this.ws.addListener("connectFailed", Banano.wsConnectionFailed.bind(this));
		this.ws.addListener("connect", this.wsConnectionEstablished.bind(this));
		this.log.debug(
			`Connecting to banano node at '${config.BananoWebSocketsAPI}'...`
		);
		this.ws.connect(`ws://${config.BananoWebSocketsAPI}`);
	}

	private async wsMessageReceived(msg: WS.IMessage): Promise<void> {
		const notification = JSON.parse(msg.utf8Data);
		const sender = notification.message.account;
		const receiver = notification.message.block.link_as_account;
		const rawAmount = notification.message.amount;
		const amount: BigNumber = BigNumber.from(
			rawAmount.substring(0, rawAmount.length - 11)
		);
		const { hash } = notification.message;

		// filter transactions sent by the users deposits wallet
		if (sender === this.usersDepositsWallet) {
			return;
		}

		// this.log.trace(`Received message ${JSON.stringify(notification)}`);
		this.log.info(
			`User ${sender} deposited ${amount} BAN in transaction ${hash}`
		);

		// ensure funds where sent to the proper wall, just in case
		if (this.usersDepositsWallet !== receiver) {
			this.log.error(
				`BAN were deposited to another wallet than the users deposit wallet: ${receiver}`
			);
			this.log.error("Ignoring this deposit");
			this.log.trace(`Received message ${JSON.stringify(notification)}`);
		}
		// record the user deposit
		await this.processUserDeposit(sender, amount, hash);
	}

	private wsConnectionEstablished(conn: WS.connection): void {
		this.log.debug("WS connection established to Banano node");
		conn.addListener("error", this.wsCoonnectionError.bind(this));
		conn.addListener("close", this.wsConnectionClosed.bind(this));
		conn.addListener("message", this.wsMessageReceived.bind(this));
		// subscribe to users deposits wallets notifications
		const subscriptionRequest = {
			action: "subscribe",
			topic: "confirmation",
			options: {
				all_local_accounts: true,
				accounts: [this.usersDepositsWallet],
			},
		};
		conn.sendUTF(JSON.stringify(subscriptionRequest));
	}

	private static wsConnectionFailed(err): void {
		console.error(
			`Couldn't connect to Banano WebSocket API at ${config.BananoWebSocketsAPI}`,
			err
		);
		// TODO: exit?
	}

	private wsCoonnectionError(err): void {
		this.log.error("Unexpected WS error", err);
		this.log.info("Reconnecting to WS API...");
		this.ws.connect(`ws://${config.BananoWebSocketsAPI}`);
	}

	private wsConnectionClosed(code: number, desc: string): void {
		this.log.info(`WS connection closed: code=${code}, desc=${desc}`);
		this.log.info("Reconnecting to WS API...");
		this.ws.connect(`ws://${config.BananoWebSocketsAPI}`);
	}

	async processPendingTransactions(wallet: string): Promise<void> {
		this.log.info(
			"Searching for pending transactions that were missed from the WS API"
		);
		const accountsPending = await banano.getAccountsPending(
			[wallet], // monitor users deposits wallet
			-1, // ask for all pending transactions
			true // ask for wallet who sent the transaction
		);
		if (accountsPending.blocks && accountsPending.blocks[wallet]) {
			const walletPendingTransactions = accountsPending.blocks[wallet];
			const transactionsHashes = [...Object.keys(walletPendingTransactions)];
			// eslint-disable-next-line no-restricted-syntax
			for (const hash of transactionsHashes) {
				const transaction = walletPendingTransactions[hash];
				const { amount, source } = transaction;
				const banAmount: BigNumber = BigNumber.from(
					amount.substring(0, amount.length - 11)
				);
				this.log.debug(
					`Got missed transaction of ${ethers.utils.formatEther(
						banAmount
					)} BAN from ${source} in transaction "${hash}"`
				);
				// record the user deposit
				// eslint-disable-next-line no-await-in-loop
				await this.processUserDeposit(source, banAmount, hash);
			}
		} else {
			this.log.debug("No pending transactions...");
		}
	}

	private async processUserDeposit(
		sender: string,
		amount: BigNumber,
		hash: string
	): Promise<void> {
		await this.mutex.runExclusive(async () => {
			// check if a pending claim is available
			if (await this.usersDepositsService.hasPendingClaim(sender)) {
				// confirm it
				await this.usersDepositsService.confirmClaim(sender);
			}

			// check if there is a valid claim
			if (!(await this.usersDepositsService.hasClaim(sender))) {
				const formattedAmount = ethers.utils.formatEther(amount);
				this.log.error(
					`No claim were made for "${sender}". Sending back the ${formattedAmount} BAN deposited`
				);
				await this.receiveTransaction(hash);
				// send back the BAN!
				try {
					await banano.sendBananoWithdrawalFromSeed(
						this.seed,
						this.seedIdx,
						sender,
						formattedAmount
					);
				} catch (err) {
					this.log.error("Unexpected error", err);
				}
			} else {
				// record the user deposit
				this.usersDepositsService.storeUserDeposit(sender, amount, hash);
				await this.receiveTransaction(hash);
			}
		});
	}

	private async receiveTransaction(hash: string) {
		// create receive transaction
		try {
			await banano.receiveBananoDepositsForSeed(
				this.seed,
				this.seedIdx,
				this.representative,
				hash
			);
		} catch (err) {
			this.log.error("Unexpected error", err);
			this.log.error(err);
		}
	}
}

export { Banano };

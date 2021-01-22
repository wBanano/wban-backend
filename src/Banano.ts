import * as banano from "@bananocoin/bananojs";
import * as WS from "websocket";
import { Logger } from "tslog";
import { UsersDepositsService } from "./services/UsersDepositsService";
import config from "./config";

const BANANO_API_URL = "https://kaliumapi.appditto.com/api";

class Banano {
	private usersDepositsWallet: string;

	private usersDepositsStorage: UsersDepositsService;

	private ws: WS.client;

	private log: Logger = new Logger();

	constructor(
		usersDepositsWallet: string,
		usersDepositsService: UsersDepositsService
	) {
		this.usersDepositsWallet = usersDepositsWallet;
		this.usersDepositsStorage = usersDepositsService;

		banano.setBananodeApiUrl(BANANO_API_URL); // TODO: try to connect to local node instead!
		// TODO: periodically run this method!
		// Banano.fetchWalletHistory(usersDepositsWallet);
	}

	subscribeToBananoNotificationsForWallet(): void {
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

	private wsMessageReceived(msg: WS.IMessage): void {
		const notification = JSON.parse(msg.utf8Data);
		const sender = notification.message.account;
		const receiver = notification.message.block.link_as_account;
		const rawAmount = notification.message.amount;
		const amount = rawAmount.substring(0, rawAmount.length - 11);
		const { hash } = notification.message;

		// log.trace(`Received message ${JSON.stringify(notification)}`);
		this.log.info(
			`User ${sender} deposited ${amount} BAN in transaction ${hash}`
		);

		// ensure funds where sent to the proper wall, just in case
		if (this.usersDepositsWallet !== receiver) {
			this.log.error(
				`BAN were deposited to another wallet than the users deposit wallet: ${receiver}`
			);
			this.log.error("Ignoring this deposit");
		}
		// record the user deposit
		this.usersDepositsStorage.storeUserDeposit(sender, amount, hash);
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

	static async fetchWalletHistory(wallet: string): Promise<void> {
		const history = await banano.getAccountHistory(wallet, -1);
		console.trace(history);
	}
}

export { Banano };

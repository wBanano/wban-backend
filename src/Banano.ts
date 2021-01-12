import * as banano from "@bananocoin/bananojs";
import * as WS from "websocket";
import { Logger } from "tslog";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import config from "./config";

const BANANO_API_URL = "https://kaliumapi.appditto.com/api";
const log: Logger = new Logger();

class Banano {
	private usersDepositsWallet: string;

	private usersDepositsStorage: UsersDepositsStorage;

	private ws: WS.client;

	constructor(
		usersDepositsWallet: string,
		usersDepositsStorage: UsersDepositsStorage
	) {
		this.usersDepositsWallet = usersDepositsWallet;
		this.usersDepositsStorage = usersDepositsStorage;

		banano.setBananodeApiUrl(BANANO_API_URL); // TODO: try to connect to local node instead!
		// TODO: periodically run this method!
		// Banano.fetchWalletHistory(usersDepositsWallet);
	}

	async subscribeToBananoNotificationsForWallet(): Promise<void> {
		log.info(
			`Subscribing to wallet notifications for '${this.usersDepositsWallet}'...`
		);
		// eslint-disable-next-line new-cap
		this.ws = new WS.client();
		this.ws.addListener("connectFailed", Banano.wsConnectionFailed.bind(this));
		this.ws.addListener("connect", this.wsConnectionEstablished.bind(this));
		log.debug(
			`Connecting to banano node at '${config.BananoWebSocketsAPI}'...`
		);
		this.ws.connect(`ws://${config.BananoWebSocketsAPI}`);
	}

	private wsMessageReceived(msg: WS.IMessage): void {
		const notification = JSON.parse(msg.utf8Data);
		const sender = notification.message.account;
		const receiver = notification.message.block.link_as_account;
		const amount = notification.message.amount / 100000000000000000000000000000;
		const { hash } = notification.message;

		// log.trace(`Received message ${JSON.stringify(notification)}`);
		log.info(`User ${sender} deposited ${amount} BAN in transaction ${hash}`);

		// ensure funds where sent to the proper wall, just in case
		if (this.usersDepositsWallet !== receiver) {
			log.error(
				`BAN were deposited to another wallet than the users deposit wallet: ${receiver}`
			);
			log.error("Ignoring this deposit");
		}
		// record the user deposit
		this.usersDepositsStorage.storeUserDeposit(sender, amount, hash);
		/*
		{
			"topic": "confirmation",
			"time": "1610533780631",
			"message": {
				"account": "ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o",
				"amount": "100000000000000000000000000000",
				"hash": "38E435918D24A63E20822703184893CC44AAA593E52F8E42DA9FBFA35ED1C4AA",
				"confirmation_type": "active_quorum",
				"block": {
					"type": "state",
					"account": "ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o",
					"previous": "8229F7C486BA5A271685EB2275BA08A5A7CA5B587812276544EC957F2BE06046",
					"representative": "ban_1tipbotgges3ss8pso6xf76gsyqnb69uwcxcyhouym67z7ofefy1jz7kepoy",
					"balance": "63162000000000000000000000000000",
					"link": "0A129193816FC22B61B74020B874F3C9967EBC75BDE9ECACB95832737BBAD905",
					"link_as_account": "ban_14ikk8br4uy47fiugi31q3th9kephty9dhhbxkpdkp3kgfxuopa7g98dmzrm",
					"signature": "D5089CF008A33874042A329351254698A445E467B86B7F89E480B47574EB78DA3A7335E7819304C696E0284F484B548C7679FB08EA8089B30EBF0F9C67E8FF03",
					"work": "ebbd560ba96c6cfc",
					"subtype": "send"
				}
			}
		}
		*/
	}

	private wsConnectionEstablished(conn: WS.connection): void {
		log.debug("WS connection established to Banano node");
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
		log.error(
			`Couldn't connect to Banano WebSocket API at ${config.BananoWebSocketsAPI}`,
			err
		);
		// TODO: exit?
	}

	private wsCoonnectionError(err): void {
		log.error("Unexpected WS error", err);
		log.info("Reconnecting to WS API...");
		this.ws.connect(`ws://${config.BananoWebSocketsAPI}`);
	}

	private wsConnectionClosed(code: number, desc: string): void {
		log.info(`WS connection closed: code=${code}, desc=${desc}`);
		log.info("Reconnecting to WS API...");
		this.ws.connect(`ws://${config.BananoWebSocketsAPI}`);
	}

	static async fetchWalletHistory(wallet: string): Promise<void> {
		const history = await banano.getAccountHistory(wallet, -1);
		log.trace(history);
	}
}

export { Banano };

import express from "express";
import cors from "cors";
import { Logger } from "tslog";
import { Service } from "./Service";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./RedisUsersDepositsStorage";
import { UsersDepositsService } from "./UsersDepositsService";

const app = express();
const PORT = 3000;
const log: Logger = new Logger();

app.use(cors());
app.use(express.json());

const usersDepositsStorage: UsersDepositsStorage = new RedisUsersDepositsStorage();
const usersDepositsService: UsersDepositsService = new UsersDepositsService(
	usersDepositsStorage
);
const svc = new Service(usersDepositsService);
svc.start();

app.get("/health", (req, res) => {
	res.send(
		"TODO: check if connections to Banano node, BSC node and Redis node are okay!"
	);
});

app.get("/deposits/:ban_wallet", async (req, res) => {
	const banWallet = req.params.ban_wallet;
	const availableBalance = await svc.getUserAvailableBalance(banWallet);
	log.info(`User ${banWallet} has an available balance of ${availableBalance}`);
	res.send({
		deposits: availableBalance,
	});
});

app.post("/swap", async (req, res) => {
	// TODO: make sure all required parameters are sent!
	const banAmount: number = req.body.amount as number;
	const banWallet: string = req.body.ban;
	const bscWallet: string = req.body.bsc;
	const signature: string = req.body.sig;

	log.debug(
		`banAmount=${banAmount}, banWallet=${banWallet}, bscWallet=${bscWallet}, signature=${signature}`
	);

	const result = await svc.swap(banWallet, banAmount, bscWallet, signature);
	if (!result) {
		res.send(`Swap request for ${banAmount} is not possible.`);
		return;
	}

	res.send(
		`Should swap ${banAmount} BAN from ${banWallet} to wBAN ${bscWallet}`
	);
});

app.listen(PORT, async () => {
	console.log(
		`⚡️[wBAN backend]: Server is running at http://localhost:${PORT}`
	);
});

import express from "express";
import cors from "cors";
import { Logger } from "tslog";
import { Service } from "./Service";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./RedisUsersDepositsStorage";

const app = express();
const PORT = 3000;
const log: Logger = new Logger();

app.use(cors());

const usersDepositsStorage: UsersDepositsStorage = new RedisUsersDepositsStorage();
const svc = new Service(usersDepositsStorage);
svc.start();

app.get("/health", (req, res) => {
	res.send(
		"TODO: check if connections to Banano node, BSC node and Redis node are okay!"
	);
});

app.get("/deposits/:ban_wallet", async (req, res) => {
	const banWallet = req.params.ban_wallet;
	const availableBalance = await svc.getUserAvailableBalance(banWallet);
	log.info(
		`User ${banWallet} has an available balance of ${availableBalance} BAN`
	);
	res.send({
		deposits: availableBalance,
	});
	// res.send(`Available balance: ${availableBalance} BAN`);
});

app.get("/swap", async (req, res) => {
	// TODO: make sure all required parameters are sent!
	const banAmount: number = parseFloat(req.query.amount as string);
	const banWallet: string = req.query.ban as string;
	const bscWallet = req.query.bsc as string;
	const signature = req.query.sig as string;

	const result = await svc.swap(banWallet, banAmount, signature);
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

import express from "express";
import { Logger } from "tslog";
import { Service } from "./Service";
import { UsersDepositsStorage } from "./UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./RedisUsersDepositsStorage";

const app = express();
const PORT = 3000;
const log: Logger = new Logger();

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
	res.send(`Available balance: ${availableBalance} BAN`);
});

app.get("/swap", (req, res) => {
	const banAmount = req.query.amount;
	const banWallet = req.query.ban;
	const bscWallet = req.query.bsc;
	const signature = req.query.sig;
	// TODO: verify signature
	log.debug(`Checking signature '${signature}'`);
	// TODO: check if deposits are greater than or equal to amount to swap
	// TODO: decrease user deposits
	// TODO: mint wBAN tokens

	res.send(
		`Should swap ${banAmount} BAN from ${banWallet} to wBAN ${bscWallet}`
	);
});

app.listen(PORT, async () => {
	console.log(
		`⚡️[wBAN backend]: Server is running at http://localhost:${PORT}`
	);
});

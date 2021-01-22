import express from "express";
import cors from "cors";
import { Logger } from "tslog";
import { BigNumber } from "ethers";
import { Service } from "./services/Service";
import { UsersDepositsStorage } from "./storage/UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./storage/RedisUsersDepositsStorage";
import { UsersDepositsService } from "./services/UsersDepositsService";
import SwapRequest from "./models/requests/SwapRequest";

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
	res.send({
		deposits: availableBalance,
	});
});

app.post("/swap", async (req, res) => {
	// TODO: make sure all required parameters are sent!
	const swapRequest: SwapRequest = req.body as SwapRequest;
	const banAmount: string = swapRequest.amount;
	const banWallet: string = swapRequest.ban;
	const bscWallet: string = swapRequest.bsc;
	const signature: string = swapRequest.sig;

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

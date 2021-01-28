import express from "express";
import cors from "cors";
import { Logger } from "tslog";
import { Service } from "./services/Service";
import { UsersDepositsStorage } from "./storage/UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./storage/RedisUsersDepositsStorage";
import { UsersDepositsService } from "./services/UsersDepositsService";
import ClaimRequest from "./models/requests/ClaimRequest";
import SwapRequest from "./models/requests/SwapRequest";
import config from "./config";

const app = express();
const PORT = 3000;
const log: Logger = config.Logger.getChildLogger();

app.use(cors());
app.use(express.json());

const usersDepositsStorage: UsersDepositsStorage = new RedisUsersDepositsStorage();
const usersDepositsService: UsersDepositsService = new UsersDepositsService(
	usersDepositsStorage
);
const svc = new Service(usersDepositsService);
svc.start();

app.get("/health", (req, res) => {
	// TODO: check if connections to Banano node, BSC node and Redis node are okay!
	res.send({
		status: "OK",
	});
});

app.get("/deposits/ban/wallet", async (req, res) => {
	res.send({
		address: config.BananoUsersDepositsWallet,
	});
});

app.get("/deposits/ban/:ban_wallet", async (req, res) => {
	const banWallet = req.params.ban_wallet;

	res.set({
		"Cache-Control": "no-cache",
		"Content-Type": "text/event-stream",
		Connection: "keep-alive",
	});
	res.flushHeaders();

	res.write("retry: 10000\n\n");

	while (true) {
		// eslint-disable-next-line no-await-in-loop
		await new Promise((resolve) => setTimeout(resolve, 5000));
		// eslint-disable-next-line no-await-in-loop
		res.write(`data: ${await svc.getUserAvailableBalance(banWallet)}\n\n`);
	}
});

app.post("/claim", async (req, res) => {
	// TODO: make sure all required parameters are sent!
	const claimRequest: ClaimRequest = req.body as ClaimRequest;
	const { banAddress, bscAddress, sig } = claimRequest;
	log.info(
		`Check claim for ${banAddress} and ${bscAddress} with signature ${sig}`
	);
	const result = await svc.claim(banAddress, bscAddress, sig);
	if (result) {
		res.send({
			status: "OK",
		});
	} else {
		res.status(409).send({
			message: "Invalid claim.",
		});
	}
});

app.post("/swap", async (req, res) => {
	// TODO: make sure all required parameters are sent!
	const swapRequest: SwapRequest = req.body as SwapRequest;
	const banAmount: number = swapRequest.amount;
	const banWallet: string = swapRequest.ban;
	const bscWallet: string = swapRequest.bsc;
	const signature: string = swapRequest.sig;

	log.debug(
		`banAmount=${banAmount}, banWallet=${banWallet}, bscWallet=${bscWallet}, signature=${signature}`
	);

	const result = await svc.swap(banWallet, banAmount, bscWallet, signature);
	if (!result) {
		res.status(409).send(`Swap request for ${banAmount} BAN is not possible.`);
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

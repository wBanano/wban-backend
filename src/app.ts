import express, { Application, Request, Response } from "express";
import cors from "cors";
import { Logger } from "tslog";
import { Service } from "./services/Service";
import { UsersDepositsStorage } from "./storage/UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./storage/RedisUsersDepositsStorage";
import { UsersDepositsService } from "./services/UsersDepositsService";
import ClaimRequest from "./models/requests/ClaimRequest";
import SwapRequest from "./models/requests/SwapRequest";
import WithdrawalRequest from "./models/requests/WithdrawalRequest";
import BalanceLockedError from "./errors/BalanceLockedError";
import BSCTransactionFailedError from "./errors/BSCTransactionFailedError";
import config from "./config";
import { ClaimResponse } from "./models/responses/ClaimResponse";

const app: Application = express();
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

app.get("/health", (req: Request, res: Response) => {
	// TODO: check if connections to Banano node, BSC node and Redis node are okay!
	res.send({
		status: "OK",
	});
});

app.get("/deposits/ban/wallet", async (req: Request, res: Response) => {
	res.send({
		address: config.BananoUsersDepositsWallet,
	});
});

app.get("/deposits/ban/:ban_wallet", async (req: Request, res: Response) => {
	const banWallet = req.params.ban_wallet;

	res.set({
		"Cache-Control": "no-cache",
		"Content-Type": "text/event-stream",
		Connection: "keep-alive",
	});
	res.flushHeaders();

	res.write("retry: 10000\n\n");

	let connected = true;
	req.on("close", () => {
		connected = false;
	});

	while (connected) {
		// eslint-disable-next-line no-await-in-loop
		await new Promise((resolve) => setTimeout(resolve, 5000));
		// eslint-disable-next-line no-await-in-loop
		res.write(`data: ${await svc.getUserAvailableBalance(banWallet)}\n\n`);
	}
});

app.post("/withdrawals/ban", async (req: Request, res: Response) => {
	// TODO: make sure all required parameters are sent!
	const withdrawalRequest: WithdrawalRequest = req.body as WithdrawalRequest;
	const banAmount: number = withdrawalRequest.amount;
	const banWallet: string = withdrawalRequest.ban;
	const bscWallet: string = withdrawalRequest.bsc;
	const signature: string = withdrawalRequest.sig;

	log.info(`Withdrawing ${banAmount} BAN to ${banWallet}`);

	try {
		const txnHash = await svc.withdrawBAN(
			banWallet,
			banAmount,
			bscWallet,
			signature
		);
		res.send({
			message: `Transaction worked!`,
			transaction: txnHash,
			link: `${config.BinanceSmartChainBlockExplorerUrl}/tx/${txnHash}`,
		});
	} catch (err) {
		if (err instanceof BalanceLockedError) {
			res.status(409).send({
				error: "Another swap is already in progress!",
			});
		} else if (err instanceof BSCTransactionFailedError) {
			const txnError: BSCTransactionFailedError = err;
			res.status(409).send({
				error: "Transaction failed!",
				transaction: txnError.hash,
				link: txnError.getTransactionUrl(),
			});
		} else {
			log.error(err);
			res.status(409).send({
				error: `Swap request for ${banAmount} BAN is not possible.`,
			});
		}
	}
});

app.post("/claim", async (req: Request, res: Response) => {
	// TODO: make sure all required parameters are sent!
	const claimRequest: ClaimRequest = req.body as ClaimRequest;
	const { banAddress, bscAddress, sig } = claimRequest;
	log.info(
		`Check claim for ${banAddress} and ${bscAddress} with signature ${sig}`
	);
	const result: ClaimResponse = await svc.claim(banAddress, bscAddress, sig);
	switch (result) {
		case ClaimResponse.Ok:
			res.send({
				status: "OK",
			});
			break;
		case ClaimResponse.AlreadyDone:
			res.status(202).send({
				status: "Already done",
			});
			break;
		case ClaimResponse.InvalidOwner:
			res.status(409).send({
				message:
					"This BAN wallet was already claimed by another Binance Smart Chain Address.",
			});
			break;
		case ClaimResponse.InvalidSignature:
		case ClaimResponse.Error:
		default:
			res.status(409).send({
				message: "Invalid claim.",
			});
	}
});

app.post("/swap", async (req: Request, res: Response) => {
	// TODO: make sure all required parameters are sent!
	const swapRequest: SwapRequest = req.body as SwapRequest;
	const banAmount: number = swapRequest.amount;
	const banWallet: string = swapRequest.ban;
	const bscWallet: string = swapRequest.bsc;
	const signature: string = swapRequest.sig;

	log.debug(
		`banAmount=${banAmount}, banWallet=${banWallet}, bscWallet=${bscWallet}, signature=${signature}`
	);

	try {
		const txnHash = await svc.swap(banWallet, banAmount, bscWallet, signature);
		res.send({
			message: `Transaction worked!`,
			transaction: txnHash,
			link: `${config.BinanceSmartChainBlockExplorerUrl}/tx/${txnHash}`,
		});
	} catch (err) {
		if (err instanceof BalanceLockedError) {
			res.status(409).send({
				error: "Another swap is already in progress!",
			});
		} else if (err instanceof BSCTransactionFailedError) {
			const txnError: BSCTransactionFailedError = err;
			res.status(409).send({
				error: "Transaction failed!",
				transaction: txnError.hash,
				link: txnError.getTransactionUrl(),
			});
		} else {
			log.error(err);
			res.status(409).send({
				error: `Swap request for ${banAmount} BAN is not possible.`,
			});
		}
	}
});

app.listen(PORT, async () => {
	console.log(
		`⚡️[wBAN backend]: Server is running at http://localhost:${PORT}`
	);
});

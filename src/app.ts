import express, { Application, Request, Response } from "express";
import cors from "cors";
import { Logger } from "tslog";
import { BigNumber, ethers } from "ethers";
import Session from "express-session";
import { generateNonce, ErrorTypes, SiweMessage } from "siwe";
import SSEManager from "./services/sse/SSEManager";
import { Service } from "./services/Service";
import { TokensList } from "./services/TokensList";
import { BlockchainGasPriceTracker } from "./services/BlockchainGasPriceTracker";
import { OwlracleGasPriceTracker } from "./services/OwlracleGasPriceTracker";
import { EtherscanGasPriceTracker } from "./services/EtherscanGasPriceTracker";
import { UsersDepositsStorage } from "./storage/UsersDepositsStorage";
import { RedisUsersDepositsStorage } from "./storage/RedisUsersDepositsStorage";
import { UsersDepositsService } from "./services/UsersDepositsService";
import ClaimRequest from "./models/requests/ClaimRequest";
import SwapRequest from "./models/requests/SwapRequest";
import WithdrawalRequest from "./models/requests/WithdrawalRequest";
import config from "./config";
import { ClaimResponse } from "./models/responses/ClaimResponse";
import ProcessingQueue from "./services/queuing/ProcessingQueue";
import JobListener from "./services/queuing/JobListener";
import RedisProcessingQueue from "./services/queuing/RedisProcessingQueue";
import BlockchainScanQueue from "./services/queuing/BlockchainScanQueue";
import RedisBlockchainScanQueue from "./services/queuing/RedisBlockchainScanQueue";
import History from "./models/responses/History";
import GaslessSwap from "./models/operations/GaslessSwap";
import { CoinExPricer } from "./prices/CoinExPricer";
import KirbyBananoWalletsBlacklist from "./services/KirbyBananoWalletsBlacklist";

const app: Application = express();
const sseManager = new SSEManager();
const PORT = 3000;
const log: Logger = config.Logger.getChildLogger();

const corsWhitelist = [
	"https://wrap.banano.cc",
	"https://bsc.banano.cc",
	"https://polygon.banano.cc",
	"https://fantom.banano.cc",
	"https://wban-testing.banano.cc",
	"https://wban-testing.netlify.app",
	"http://localhost:8080",
];

app.use(
	cors({
		origin(origin, callback) {
			// allow requests with no origin
			if (!origin) return callback(null, true);
			if (origin.endsWith("ngrok.io")) {
				return callback(null, true);
			}
			if (corsWhitelist.indexOf(origin) === -1) {
				const message =
					"The CORS policy for this origin doesn't allow access from the particular origin.";
				return callback(new Error(message), false);
			}
			return callback(null, true);
		},
		credentials: true,
	})
);
app.use(express.json());
app.set("trust proxy", 1); // trust first proxy;
app.use(
	Session({
		name: "wBAN",
		secret: config.SiweSessionSecret,
		resave: true,
		saveUninitialized: true,
		cookie: { secure: true, sameSite: "none", httpOnly: true },
	})
);

const usersDepositsStorage: UsersDepositsStorage =
	new RedisUsersDepositsStorage();
const usersDepositsService: UsersDepositsService = new UsersDepositsService(
	usersDepositsStorage
);
const processingQueue: ProcessingQueue = new RedisProcessingQueue();
const blockchainScanQueue: BlockchainScanQueue = new RedisBlockchainScanQueue(
	usersDepositsService
);
const gasPriceTracker: BlockchainGasPriceTracker =
	config.BlockchainGasPriceStrategy === "owlracle"
		? new OwlracleGasPriceTracker()
		: new EtherscanGasPriceTracker();
const tokensList = new TokensList();
const svc = new Service(
	usersDepositsService,
	processingQueue,
	blockchainScanQueue,
	new KirbyBananoWalletsBlacklist()
);
svc.start();

app.get("/health", async (req: Request, res: Response) => {
	// check Blockchain connectivity by checking balance of an account
	try {
		await svc.blockchain.getWalletBalance();
	} catch (e) {
		log.error("Can't request Blockchain balance", e);
		res.status(503).send({
			status: "Can't request Blockchain balance",
		});
		return;
	}

	// check Banano connectivity by checking balance of an account
	try {
		await svc.banano.getBalance(
			"ban_1wban1mwe1ywc7dtknaqdbog5g3ah333acmq8qxo5anibjqe4fqz9x3xz6ky"
		);
	} catch (e) {
		log.error("Can't request Banano balance", e);
		res.status(503).send({
			status: "Can't request Banano balance",
		});
		return;
	}

	// check connection to Redis node
	try {
		usersDepositsStorage.isClaimed(
			"ban_1wban1mwe1ywc7dtknaqdbog5g3ah333acmq8qxo5anibjqe4fqz9x3xz6ky"
		);
	} catch (e) {
		log.error("Can't make Redis query", e);
		res.status(503).send({
			status: "Can't make Redis query",
		});
		return;
	}

	res.send({
		status: "OK",
	});
});

app.get("/deposits/ban/wallet", async (req: Request, res: Response) => {
	res.send({
		address: config.BananoUsersDepositsHotWallet,
	});
});

app.get("/deposits/ban/:ban_wallet", async (req: Request, res: Response) => {
	const banWallet = req.params.ban_wallet;
	const balance = await svc.getUserAvailableBalance(banWallet);
	res.send({
		balance: ethers.utils.formatEther(balance),
	});
});

app.post("/withdrawals/ban", async (req: Request, res: Response) => {
	// TODO: make sure all required parameters are sent!
	const withdrawalRequest: WithdrawalRequest = req.body as WithdrawalRequest;
	const banAmount: number = withdrawalRequest.amount;
	const banWallet: string = withdrawalRequest.ban;
	const blockchainWallet: string = withdrawalRequest.blockchain;
	const signature: string = withdrawalRequest.sig;

	log.info(`Withdrawing ${banAmount} BAN to ${banWallet}`);

	await svc.withdrawBAN(
		banWallet,
		banAmount.toString(),
		blockchainWallet,
		Date.now(),
		signature
	);
	res.status(201).send();
});

app.get("/withdrawals/pending", async (req: Request, res: Response) => {
	const balance = await svc.getPendingWithdrawalsAmount();
	res.send({
		amount: ethers.utils.formatEther(balance),
	});
});

app.get(
	"/claim/:ban_wallet/:bc_wallet",
	async (req: Request, res: Response) => {
		const banWallet = req.params.ban_wallet;
		const bcWallet = req.params.bc_wallet;
		log.info(`Check if claim exists for ${banWallet} and ${bcWallet}`);
		const claimDone = await svc.claimAvailable(banWallet, bcWallet);
		if (claimDone) {
			res.status(202).send({
				status: "Claim done",
			});
		} else {
			res.status(404).send();
		}
	}
);

app.post("/claim", async (req: Request, res: Response) => {
	// TODO: make sure all required parameters are sent!
	const claimRequest: ClaimRequest = req.body as ClaimRequest;
	const { banAddress, blockchainAddress, sig } = claimRequest;
	log.info(
		`Check claim for ${banAddress} and ${blockchainAddress} with signature ${sig}`
	);
	const result: ClaimResponse = await svc.claim(
		banAddress,
		blockchainAddress,
		sig
	);
	switch (result) {
		case ClaimResponse.Ok:
			res.send({
				status: "OK",
			});
			break;
		case ClaimResponse.Blacklisted:
			res.status(403).send({
				message: "This BAN wallet is blacklisted.",
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
					"This BAN wallet was already claimed by another Blockchain Address.",
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
	const swapRequest: SwapRequest = req.body as SwapRequest;
	const banAmount: number = swapRequest.amount;
	const banWallet: string = swapRequest.ban;
	const blockchainWallet: string = swapRequest.blockchain;
	const signature: string = swapRequest.sig;

	log.debug(
		`banAmount=${banAmount}, banWallet=${banWallet}, blockchainWallet=${blockchainWallet}, signature=${signature}`
	);

	await svc.swapToWBAN(
		banWallet,
		banAmount,
		blockchainWallet,
		Date.now(),
		signature
	);
	res.status(201).send();
});

app.get("/history/:blockchain/:ban", async (req: Request, res: Response) => {
	const blockchainWallet = req.params.blockchain;
	const banWallet = req.params.ban;
	const history: History = await svc.getHistory(blockchainWallet, banWallet);
	res.send(history);
});

app.get("/prices", async (req: Request, res: Response) => {
	const [banPrice, bnbPrice, ethPrice, maticPrice, ftmPrice] =
		await Promise.all([
			new CoinExPricer("BANUSDT").getPriceInUSD(),
			new CoinExPricer("BNBUSDC").getPriceInUSD(),
			new CoinExPricer("ETHUSDC").getPriceInUSD(),
			new CoinExPricer("MATICUSDC").getPriceInUSD(),
			new CoinExPricer("FTMUSDC").getPriceInUSD(),
		]);
	res.send({
		ban: banPrice,
		bnb: bnbPrice,
		eth: ethPrice,
		matic: maticPrice,
		ftm: ftmPrice,
	});
});

app.get("/blockchain/gas-price", async (req: Request, res: Response) => {
	try {
		const gasPrice: BigNumber = await gasPriceTracker.getGasPriceTrackerData();
		log.info("Gas price:", ethers.utils.formatUnits(gasPrice, "gwei"), "gwei");
		res.type("json").send({ gasPrice: gasPrice.toString() });
	} catch (err: unknown) {
		log.error("Can't fetch gas price", err);
		res.type("json").status(503);
	}
});

app.get("/dex/tokens", async (req: Request, res: Response) => {
	res.type("json").send(await tokensList.getTokensList());
});

app.get("/gasless/settings", async (req: Request, res: Response) => {
	res.type("json").send({
		enabled: config.BlockchainRelayerEnabled,
		banThreshold: config.BlockchainGasLessBananoThreshold,
		cryptoThreshold: config.BlockchainGasLessCryptoBalanceThreshold,
		swapContract: config.WBANGaslessSwapAddress,
	});
});

app.get("/gasless/settings/:ban", async (req: Request, res: Response) => {
	const banWallet = req.params.ban;
	const freeSwapDone = await usersDepositsService.isFreeSwapAlreadyDone(
		banWallet
	);
	res.type("json").send({
		gaslessSwapAllowed: !freeSwapDone,
	});
});

app.post("/gasless/swap/:ban", async (req: Request, res: Response) => {
	const banWallet = req.params.ban;
	const swap: GaslessSwap = req.body;
	try {
		await svc.gaslessSwap(banWallet, swap);
		res.status(200).send();
	} catch (err: unknown) {
		res.status(500).send(err);
	}
});

app.get("/relink", async (req: Request, res: Response) => {
	if (!req.session.siwe) {
		res.status(401).json({ message: "You have to first sign_in" });
		return;
	}
	log.debug("User is authenticated!");
	const blockchainAddress = req.session.siwe.address;
	const banAddresses: Array<string> =
		await svc.getBanAddressesForBlockchainAddress(blockchainAddress);
	res.status(200).send({ banAddresses });
});

app.get("/nonce", async (req: Request, res: Response) => {
	req.session.nonce = generateNonce();
	res.setHeader("Content-Type", "text/plain");
	res.status(200).send(req.session.nonce);
});

app.post("/verify", async (req: Request, res: Response) => {
	try {
		if (!req.body.message) {
			res
				.status(422)
				.json({ message: "Expected prepareMessage object as body." });
			return;
		}

		const message = new SiweMessage(req.body.message);
		const fields = await message.validate(req.body.signature);
		if (fields.nonce !== req.session.nonce) {
			res.status(422).json({ message: "Invalid nonce." });
			return;
		}
		req.session.siwe = fields;
		req.session.cookie.expires = new Date(
			fields.expirationTime ?? Date.now() + 10 * 60 * 1_000
		);
		req.session.save(() => res.status(200).end());
	} catch (e: any) {
		req.session.siwe = null;
		req.session.nonce = null;
		log.error(e);
		switch (e) {
			case ErrorTypes.EXPIRED_MESSAGE: {
				req.session.save(() => res.status(440).json({ message: e.message }));
				break;
			}
			case ErrorTypes.INVALID_SIGNATURE: {
				req.session.save(() => res.status(422).json({ message: e.message }));
				break;
			}
			default: {
				req.session.save(() => res.status(500).json({ message: e.message }));
				break;
			}
		}
	}
});

/*
 * SERVER-SIDE EVENT MANAGEMENT
 */

app.set("sseManager", sseManager);
setInterval(
	() =>
		sseManager.broadcast({
			type: "ping",
			data: "ping",
		}),
	15_000
);

app.get("/events/:ban_wallet", async (req: Request, res: Response) => {
	const sse = req.app.get("sseManager");
	const id = req.params.ban_wallet;
	sse.open(id, res);
	req.on("close", () => {
		sse.delete(id);
	});
});

const jobListener: JobListener = {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	onJobCompleted(id: string, name: string, result: any): void {
		if (!result) {
			return;
		}
		log.debug(
			`Job ${name} with id ${id} completed with result ${JSON.stringify(
				result
			)}`
		);
		if (result.banWallet) {
			sseManager.unicast(result.banWallet, {
				id,
				type: name,
				data: result,
			});
		} else {
			sseManager.broadcast({
				id,
				type: name,
				data: result,
			});
		}
	},
};
processingQueue.addJobListener(jobListener);

app.listen(PORT, async () => {
	console.log(
		`⚡️[wBAN backend]: Server is running at http://localhost:${PORT}`
	);
});

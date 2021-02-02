import * as dotenv from "dotenv";
import { Logger, TLogLevelName } from "tslog";

// dotenv.config();
let path;
switch (process.env.NODE_ENV) {
	case "test":
		path = ".env.test";
		break;
	case "testnet":
		path = ".env.testnet";
		break;
	case "mainnet":
		path = ".env.mainnet";
		break;
	default:
		path = ".env.local";
}
dotenv.config({ path });

const log: Logger = new Logger({
	name: "main",
	minLevel: process.env.LOG_LEVEL as TLogLevelName,
});

export default {
	BananoUsersDepositsWallet: process.env.BANANO_USERS_DEPOSITS_WALLET ?? "",
	BananoSeed: process.env.BANANO_SEED ?? "",
	BananoSeedIdx: Number.parseInt(process.env.BANANO_SEED, 10) ?? 0,
	BananoRepresentative: process.env.BANANO_REPRESENTATIVE ?? "",
	BananoWebSocketsAPI: process.env.BANANO_WS_API ?? "",
	BananoPendingTransactionsThreadEnabled:
		process.env.BANANO_PENDING_TXN_THREAD ?? true,

	BinanceSmartChainJsonRpc: process.env.BSC_JSON_RPC_URL ?? "",
	BinanceSmartChainBlockExplorerUrl: process.env.BSC_BLOCK_EXPLORER_URL ?? "",
	BinanceSmartChainNetworkName: process.env.BSC_NETWORK_NAME ?? "",
	BinanceSmartChainNetworkChainId:
		Number.parseInt(process.env.BSC_NETWORK_CHAIN_ID, 10) ?? 0,
	BinanceSmartChainWalletMnemonic: process.env.BSC_WALLET_MMENOMIC ?? "",

	WBANContractAddress: process.env.WBAN_CONTRACT_ADDRESS ?? "",
	WBANMintGasPrice:
		Number.parseInt(process.env.WBAN_MINT_GAS_PRICE, 10) ?? 61_000,
	WBANMintGasLimit: process.env.WBAN_MINT_GAS_LIMIT ?? "20000000000",

	RedisHost: process.env.REDIS_HOST ?? "",

	Logger: log,
};

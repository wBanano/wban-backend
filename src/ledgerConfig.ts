import * as dotenv from "dotenv";
import { Logger, TLogLevelName } from "tslog";
import secretLogMasks from "./secretLogMasks";

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
	maskAnyRegEx: secretLogMasks(process.env),
});

const STORAGE_BACKENDS = ["redis", "postgres"] as const;
export type LedgerBackend = typeof STORAGE_BACKENDS[number];

function parseStorageBackend(value: string | undefined): LedgerBackend {
	const backend = value ?? "redis";
	if (!(STORAGE_BACKENDS as readonly string[]).includes(backend)) {
		throw new Error(
			`STORAGE_BACKEND must be one of ${STORAGE_BACKENDS.join(", ")}`
		);
	}
	return backend as LedgerBackend;
}

export default {
	BananoUsersDepositsHotWallet:
		process.env.BANANO_USERS_DEPOSITS_HOT_WALLET ?? "",
	BananoRPCAPI: process.env.BANANO_RPC_API ?? "",
	BananoNodeRpcHost: process.env.BANANO_NODE_RPC_HOST ?? "",

	BlockchainJsonRpc: process.env.BC_JSON_RPC_URL ?? "",
	BlockchainBlockExplorerUrl: process.env.BC_BLOCK_EXPLORER_URL ?? "",
	BlockchainNetworkName: process.env.BC_NETWORK_NAME ?? "",
	BlockchainNetworkChainId: Number.parseInt(
		process.env.BC_NETWORK_CHAIN_ID ?? "0",
		10
	),
	BlockchainWalletPendingTransactionsStartFromBlock: Number.parseInt(
		process.env.BC_PENDING_BLOCKS_START ?? "0",
		10
	),

	WBANContractAddress: process.env.WBAN_CONTRACT_ADDRESS ?? "",

	RedisHost: process.env.REDIS_HOST ?? "",
	RedisPassword: process.env.REDIS_PASSWORD || undefined,

	StorageBackend: parseStorageBackend(process.env.STORAGE_BACKEND),
	DatabaseHost: process.env.DATABASE_HOST ?? "",
	DatabasePort: Number.parseInt(process.env.DATABASE_PORT ?? "5432", 10),
	DatabaseName: process.env.DATABASE_NAME ?? "",
	DatabaseUser: process.env.DATABASE_USER ?? "",
	DatabasePassword: process.env.DATABASE_PASSWORD || undefined,

	Logger: log,
};

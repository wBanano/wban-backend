import ledgerConfig from "./ledgerConfig";

export type { LedgerBackend } from "./ledgerConfig";

export default {
	BananoUsersDepositsColdWallet:
		process.env.BANANO_USERS_DEPOSITS_COLD_WALLET ?? "",
	BananoSeed: process.env.BANANO_SEED ?? "",
	BananoSeedIdx: Number.parseInt(process.env.BANANO_SEED_INDEX ?? "0", 10),
	BananoRepresentative: process.env.BANANO_REPRESENTATIVE ?? "",
	BananoWebSocketsAPI: process.env.BANANO_WS_API ?? "",
	BananoPendingTransactionsThreadEnabled:
		process.env.BANANO_PENDING_TXN_THREAD ?? true,
	BananoUsersDepositsHotWalletMinimum:
		process.env.BANANO_USERS_DEPOSITS_HOT_WALLET_MIN ?? "0",
	BananoUsersDepositsHotWalletToColdWalletRatio:
		process.env.BANANO_USERS_DEPOSITS_HOT_WALLET_TO_COLD_WALLET_RATIO ?? "0.2",

	BlockchainGasPriceStrategy:
		process.env.BC_GAS_TRACKER_STRATEGY ?? "etherscan",
	BlockchainGasPriceTrackerApi: process.env.BC_GAS_TRACKER_API ?? "",
	BlockchainGasPriceTrackerApiKey: process.env.BC_GAS_TRACKER_API_KEY ?? "",
	BlockchainWalletMnemonic: process.env.BC_WALLET_MMENOMIC ?? "",
	BlockchainWalletMnemonicSignerIndex:
		process.env.BC_WALLET_MMENOMIC_SIGNER_INDEX ?? 0,
	BlockchainWalletPendingTransactionsThreadEnabled:
		process.env.BC_PENDING_TXN_THREAD ?? true,
	BlockchainWalletBlockRangeMax: Number.parseInt(
		process.env.BC_BLOCK_RANGE_MAX ?? "3000",
		10
	),

	BlockchainDexTokensList: process.env.BC_DEX_TOKENS_LIST_URL ?? "",

	BlockchainGasLessBananoThreshold:
		process.env.BC_GASLESS_BAN_THRESHOLD ?? 1000,
	BlockchainGasLessCryptoBalanceThreshold:
		process.env.BC_GASLESS_CRYPTO_THRESHOLD ?? 1,
	BlockchainGasLessGasBuffer: Number.parseInt(
		process.env.BC_GASLESS_GAS_BUFFER ?? "400000",
		10
	),
	BlockchainRelayerEnabled: process.env.BC_RELAYER_ENABLED === "true",
	BlockchainRelayerApiKey: process.env.BC_RELAYER_API_KEY ?? "",
	BlockchainRelayerSecretKey: process.env.BC_RELAYER_SECRET_KEY ?? "",

	WBANGaslessSwapAddress: process.env.WBAN_GASLESS_SWAP_ADDRESS ?? "",

	SiweSessionSecret: process.env.SIWE_SESSION_SECRET ?? "",

	...ledgerConfig,
};

const SECRET_SETTINGS = [
	"BANANO_RPC_API",
	"BANANO_SEED",
	"BC_GAS_TRACKER_API_KEY",
	"BC_JSON_RPC_URL",
	"BC_RELAYER_API_KEY",
	"BC_RELAYER_SECRET_KEY",
	"BC_WALLET_MMENOMIC",
	"DATABASE_PASSWORD",
	"REDIS_PASSWORD",
	"SIWE_SESSION_SECRET",
];

const MIN_SECRET_LENGTH = 8;

const URL_CREDENTIAL = String.raw`(?<=[?&](?:authorization|api[-_]?key|apikey|key|token|access_token|secret)=)[^&\s"'\\)]+`;

const escapeRegExp = (value: string): string =>
	value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export default function secretLogMasks(env: NodeJS.ProcessEnv): string[] {
	const secrets = SECRET_SETTINGS.map((name) => env[name] ?? "")
		.filter((value) => value.length >= MIN_SECRET_LENGTH)
		.sort((a, b) => b.length - a.length);
	return [...secrets.map(escapeRegExp), URL_CREDENTIAL];
}

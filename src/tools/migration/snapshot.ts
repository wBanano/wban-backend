import { Redis } from "ioredis";

export type ScoredMember = { member: string; score: number };

export type HistoryKind =
	| "deposit"
	| "withdrawal"
	| "swap_to_wban"
	| "swap_to_ban";

export type KeyType =
	| "ban-balance"
	| "deposits"
	| "withdrawals"
	| "swaps:ban-to-wban"
	| "swaps:wban-to-ban"
	| "swaps:gasless"
	| "audit"
	| "claims:pending"
	| "claims"
	| "blockchain:blocks:latest"
	| "ledger:backend"
	| "bullmq"
	| "locks"
	| "unknown";

export type Claim = { banAddress: string; blockchainAddress: string };

export type UnparsedKey = { key: string; reason: string };

export type LedgerSnapshot = {
	balances: Map<string, string>;
	history: Record<HistoryKind, Map<string, ScoredMember[]>>;
	audits: Map<string, Record<string, string>>;
	confirmedClaims: Claim[];
	pendingClaims: Claim[];
	gasless: Map<string, string>;
	lastBlockProcessed: string | undefined;
	marker: string | undefined;
	keyCounts: Record<KeyType, number>;
	unknownKeys: string[];
	unparsed: UnparsedKey[];
};

const HISTORY_PREFIXES: [string, KeyType, HistoryKind][] = [
	["deposits:", "deposits", "deposit"],
	["withdrawals:", "withdrawals", "withdrawal"],
	["swaps:ban-to-wban:", "swaps:ban-to-wban", "swap_to_wban"],
	["swaps:wban-to-ban:", "swaps:wban-to-ban", "swap_to_ban"],
];

const PREFIXES: [string, KeyType][] = [
	["bull:", "bullmq"],
	["locks:", "locks"],
	["ban-balance:", "ban-balance"],
	...HISTORY_PREFIXES.map(([prefix, type]): [string, KeyType] => [
		prefix,
		type,
	]),
	["swaps:gasless:", "swaps:gasless"],
	["audit:", "audit"],
	["claims:pending:", "claims:pending"],
	["claims:", "claims"],
];

const EXACT_KEYS: Record<string, KeyType> = {
	"blockchain:blocks:latest": "blockchain:blocks:latest",
	"ledger:backend": "ledger:backend",
};

const COUNTED_ONLY: KeyType[] = ["bullmq", "locks"];

const READ_BATCH = 500;

export function classifyKey(key: string): KeyType {
	if (EXACT_KEYS[key]) {
		return EXACT_KEYS[key];
	}
	const match = PREFIXES.find(([prefix]) => key.startsWith(prefix));
	return match ? match[1] : "unknown";
}

function suffixAfter(key: string, prefix: string): string {
	return key.slice(prefix.length);
}

function isLowercaseAddress(address: string): boolean {
	return address.length > 0 && address === address.toLowerCase();
}

function parseClaim(key: string, prefix: string): Claim | undefined {
	const rest = suffixAfter(key, prefix);
	const separator = rest.lastIndexOf(":");
	if (separator <= 0) {
		return undefined;
	}
	const claim = {
		banAddress: rest.slice(0, separator),
		blockchainAddress: rest.slice(separator + 1),
	};
	if (
		!isLowercaseAddress(claim.banAddress) ||
		!isLowercaseAddress(claim.blockchainAddress)
	) {
		return undefined;
	}
	return claim;
}

export function emptySnapshot(): LedgerSnapshot {
	return {
		balances: new Map(),
		history: {
			deposit: new Map(),
			withdrawal: new Map(),
			swap_to_wban: new Map(),
			swap_to_ban: new Map(),
		},
		audits: new Map(),
		confirmedClaims: [],
		pendingClaims: [],
		gasless: new Map(),
		lastBlockProcessed: undefined,
		marker: undefined,
		keyCounts: {
			"ban-balance": 0,
			deposits: 0,
			withdrawals: 0,
			"swaps:ban-to-wban": 0,
			"swaps:wban-to-ban": 0,
			"swaps:gasless": 0,
			audit: 0,
			"claims:pending": 0,
			claims: 0,
			"blockchain:blocks:latest": 0,
			"ledger:backend": 0,
			bullmq: 0,
			locks: 0,
			unknown: 0,
		},
		unknownKeys: [],
		unparsed: [],
	};
}

async function scanKeys(redis: Redis): Promise<string[]> {
	const keys = new Set<string>();
	const stream = redis.scanStream({ count: 1_000 });
	// eslint-disable-next-line no-restricted-syntax
	for await (const batch of stream) {
		(batch as string[]).forEach((key) => keys.add(key));
	}
	return [...keys].sort();
}

type Reader = "get" | "zrange" | "hgetall";

async function readAll(
	redis: Redis,
	keys: string[],
	reader: Reader
): Promise<Map<string, unknown | Error>> {
	const results = new Map<string, unknown | Error>();
	for (let start = 0; start < keys.length; start += READ_BATCH) {
		const batch = keys.slice(start, start + READ_BATCH);
		const pipeline = redis.pipeline();
		batch.forEach((key) => {
			switch (reader) {
				case "zrange":
					pipeline.zrange(key, 0, -1, "WITHSCORES");
					break;
				case "hgetall":
					pipeline.hgetall(key);
					break;
				case "get":
				default:
					pipeline.get(key);
			}
		});
		// eslint-disable-next-line no-await-in-loop
		const replies = (await pipeline.exec()) ?? [];
		batch.forEach((key, index) => {
			const [err, value] = replies[index] ?? [new Error("no reply"), null];
			results.set(key, err ?? value);
		});
	}
	return results;
}

function scoredMembers(reply: string[]): ScoredMember[] | undefined {
	const members: ScoredMember[] = [];
	for (let i = 0; i < reply.length; i += 2) {
		const score = Number(reply[i + 1]);
		if (!Number.isFinite(score)) {
			return undefined;
		}
		members.push({ member: reply[i], score });
	}
	return members;
}

export async function readSnapshot(redis: Redis): Promise<LedgerSnapshot> {
	const snapshot = emptySnapshot();
	const keysByType = new Map<KeyType, string[]>();
	(await scanKeys(redis)).forEach((key) => {
		const type = classifyKey(key);
		snapshot.keyCounts[type] += 1;
		if (COUNTED_ONLY.includes(type)) {
			return;
		}
		const keys = keysByType.get(type) ?? [];
		keys.push(key);
		keysByType.set(type, keys);
	});
	snapshot.unknownKeys = keysByType.get("unknown") ?? [];
	const unparsed = (key: string, reason: string) =>
		snapshot.unparsed.push({ key, reason });

	const balances = await readAll(
		redis,
		keysByType.get("ban-balance") ?? [],
		"get"
	);
	balances.forEach((value, key) => {
		const banAddress = suffixAfter(key, "ban-balance:");
		if (value instanceof Error) {
			unparsed(key, value.message);
			return;
		}
		if (!isLowercaseAddress(banAddress)) {
			unparsed(key, "BAN address is not lowercase");
			return;
		}
		if (typeof value !== "string" || !/^-?\d+$/.test(value)) {
			unparsed(key, `balance ${String(value)} is not an integer`);
			return;
		}
		snapshot.balances.set(banAddress, value);
	});

	await Promise.all(
		HISTORY_PREFIXES.map(async ([prefix, type, kind]) => {
			const zsets = await readAll(redis, keysByType.get(type) ?? [], "zrange");
			zsets.forEach((value, key) => {
				const owner = suffixAfter(key, prefix);
				if (value instanceof Error) {
					unparsed(key, value.message);
					return;
				}
				if (!isLowercaseAddress(owner)) {
					unparsed(key, "address is not lowercase");
					return;
				}
				const members = scoredMembers(value as string[]);
				if (!members) {
					unparsed(key, "a score is not a number");
					return;
				}
				snapshot.history[kind].set(owner, members);
			});
		})
	);

	const audits = await readAll(redis, keysByType.get("audit") ?? [], "hgetall");
	audits.forEach((value, key) => {
		if (value instanceof Error) {
			unparsed(key, value.message);
			return;
		}
		snapshot.audits.set(
			suffixAfter(key, "audit:"),
			value as Record<string, string>
		);
	});

	const claimTypes: [KeyType, string, Claim[]][] = [
		["claims:pending", "claims:pending:", snapshot.pendingClaims],
		["claims", "claims:", snapshot.confirmedClaims],
	];
	await Promise.all(
		claimTypes.map(async ([type, prefix, target]) => {
			const values = await readAll(redis, keysByType.get(type) ?? [], "get");
			values.forEach((value, key) => {
				const claim = parseClaim(key, prefix);
				if (value instanceof Error) {
					unparsed(key, value.message);
					return;
				}
				if (!claim) {
					unparsed(
						key,
						"claim key is not claims:<ban>:<blockchain> in lowercase"
					);
					return;
				}
				target.push(claim);
			});
		})
	);

	const gasless = await readAll(
		redis,
		keysByType.get("swaps:gasless") ?? [],
		"get"
	);
	gasless.forEach((value, key) => {
		const banAddress = suffixAfter(key, "swaps:gasless:");
		if (value instanceof Error || typeof value !== "string") {
			unparsed(
				key,
				value instanceof Error ? value.message : "no transaction id"
			);
			return;
		}
		if (!isLowercaseAddress(banAddress)) {
			unparsed(key, "BAN address is not lowercase");
			return;
		}
		snapshot.gasless.set(banAddress, value);
	});

	const singles = await readAll(
		redis,
		[
			...(keysByType.get("blockchain:blocks:latest") ?? []),
			...(keysByType.get("ledger:backend") ?? []),
		],
		"get"
	);
	singles.forEach((value, key) => {
		if (value instanceof Error) {
			unparsed(key, value.message);
			return;
		}
		if (key === "ledger:backend") {
			snapshot.marker = String(value);
			return;
		}
		snapshot.lastBlockProcessed = String(value);
	});

	return snapshot;
}

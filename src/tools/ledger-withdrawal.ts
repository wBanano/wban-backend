import { Pool } from "pg";
import { ethers } from "ethers";
import {
	createDatabase,
	poolConfigFromEnv,
} from "../storage/postgres/database";
import {
	ReservedWithdrawal,
	WithdrawalReservations,
} from "../storage/postgres/WithdrawalReservations";
import {
	AccountHistoryEntry,
	fetchHotWalletHistory,
	matchingSends,
} from "../services/HotWalletSends";

const HISTORY_COUNT = 1_000;

const USAGE = `usage:
  yarn ledger:withdrawal list
  yarn ledger:withdrawal inspect <id>
  yarn ledger:withdrawal confirm <id> <ban block hash>
  yarn ledger:withdrawal release <id> [--no-matching-send-is-ok]`;

function summary(withdrawal: ReservedWithdrawal): string {
	return `#${withdrawal.id} ${ethers.utils.formatEther(
		withdrawal.amount
	)} BAN to ${withdrawal.banAddress}, requested ${new Date(
		withdrawal.requestTimestamp
	).toISOString()}, reserved ${withdrawal.reservedAt.toISOString()}`;
}

async function reservationOrFail(
	reservations: WithdrawalReservations,
	id: string | undefined
): Promise<ReservedWithdrawal> {
	const reservation = await reservations.get(Number(id));
	if (!reservation) {
		throw new Error(`No reserved withdrawal #${id}`);
	}
	return reservation;
}

async function candidateSends(
	reservations: WithdrawalReservations,
	reservation: ReservedWithdrawal
): Promise<{ entry: AccountHistoryEntry; recorded: boolean }[]> {
	const sends = matchingSends(
		await fetchHotWalletHistory(HISTORY_COUNT),
		reservation
	);
	const recorded = await reservations.recordedWithdrawalHashes(
		sends.map((send) => send.hash)
	);
	return sends.map((entry) => ({ entry, recorded: recorded.has(entry.hash) }));
}

function printCandidates(
	candidates: { entry: AccountHistoryEntry; recorded: boolean }[]
): void {
	if (candidates.length === 0) {
		console.log(
			`No matching send in the last ${HISTORY_COUNT} hot wallet blocks`
		);
		return;
	}
	candidates.forEach(({ entry, recorded }) =>
		console.log(
			`  ${entry.hash} at ${new Date(
				entry.localTimestamp * 1_000
			).toISOString()}${
				recorded ? " (already recorded for another withdrawal)" : ""
			}`
		)
	);
}

async function list(reservations: WithdrawalReservations): Promise<void> {
	const reserved = await reservations.list();
	if (reserved.length === 0) {
		console.log("No reserved withdrawals");
		return;
	}
	reserved.forEach((withdrawal) => console.log(summary(withdrawal)));
}

async function inspect(
	reservations: WithdrawalReservations,
	id: string | undefined
): Promise<void> {
	const reservation = await reservationOrFail(reservations, id);
	console.log(summary(reservation));
	console.log("Matching sends from the hot wallet:");
	printCandidates(await candidateSends(reservations, reservation));
}

async function confirm(
	reservations: WithdrawalReservations,
	id: string | undefined,
	hash: string | undefined
): Promise<void> {
	const reservation = await reservationOrFail(reservations, id);
	const candidates = await candidateSends(reservations, reservation);
	const candidate = candidates.find(
		({ entry }) => entry.hash === hash?.toUpperCase()
	);
	if (!candidate) {
		printCandidates(candidates);
		throw new Error(
			`${hash} is not a matching send from the hot wallet for ${summary(
				reservation
			)}`
		);
	}
	if (candidate.recorded) {
		throw new Error(`${hash} is already recorded for another withdrawal`);
	}
	await reservations.confirm(reservation.id, candidate.entry.hash);
	console.log(`Confirmed ${summary(reservation)} with ${candidate.entry.hash}`);
}

async function release(
	reservations: WithdrawalReservations,
	id: string | undefined,
	flags: string[]
): Promise<void> {
	const reservation = await reservationOrFail(reservations, id);
	const unrecorded = (await candidateSends(reservations, reservation)).filter(
		({ recorded }) => !recorded
	);
	if (unrecorded.length > 0 && !flags.includes("--no-matching-send-is-ok")) {
		printCandidates(unrecorded);
		throw new Error(
			"The hot wallet has matching sends that no withdrawal records. Confirm one of them, or pass --no-matching-send-is-ok if none of them belongs to this withdrawal"
		);
	}
	await reservations.release(reservation.id);
	console.log(
		`Released ${summary(reservation)}, the amount is back in its balance`
	);
}

async function run(args: string[]): Promise<void> {
	const [command, id, ...rest] = args;
	const pool = new Pool(poolConfigFromEnv());
	const reservations = new WithdrawalReservations(createDatabase(pool));
	try {
		switch (command) {
			case "list":
				return await list(reservations);
			case "inspect":
				return await inspect(reservations, id);
			case "confirm":
				return await confirm(reservations, id, rest[0]);
			case "release":
				return await release(reservations, id, rest);
			default:
				console.log(USAGE);
				return undefined;
		}
	} finally {
		await pool.end();
	}
}

run(process.argv.slice(2)).catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});

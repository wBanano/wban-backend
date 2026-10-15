import { Pool } from "pg";
import { ethers } from "ethers";
import {
	createDatabase,
	poolConfigFromEnv,
} from "../storage/postgres/database";
import {
	RefundReservations,
	ReservedRefund,
} from "../storage/postgres/RefundReservations";
import {
	AccountHistoryEntry,
	fetchHotWalletHistory,
	historyReachesBack,
	matchingSends,
} from "../services/HotWalletSends";
import safeErrorMessage from "./migration/safeErrorMessage";
import { assertNoLookalike, isOldEnough } from "./reservationChecks";

const HISTORY_COUNT = 1_000;

const USAGE = `usage:
  yarn ledger:refund list
  yarn ledger:refund inspect <deposit hash>
  yarn ledger:refund confirm <deposit hash> <ban block hash>`;

type Candidate = { entry: AccountHistoryEntry; recorded: boolean };

function summary(refund: ReservedRefund): string {
	return `deposit ${refund.depositHash}: ${ethers.utils.formatEther(
		refund.amount
	)} BAN back to ${
		refund.banAddress
	}, reserved ${refund.reservedAt.toISOString()}`;
}

async function reservationOrFail(
	reservations: RefundReservations,
	depositHash: string | undefined
): Promise<ReservedRefund> {
	const reservation = depositHash && (await reservations.get(depositHash));
	if (!reservation) {
		throw new Error(`No reserved refund for deposit ${depositHash}`);
	}
	return reservation;
}

async function candidateSends(
	reservations: RefundReservations,
	reservation: ReservedRefund
): Promise<Candidate[]> {
	const history = await fetchHotWalletHistory(HISTORY_COUNT);
	if (!historyReachesBack(history, HISTORY_COUNT, reservation)) {
		throw new Error(
			`The last ${HISTORY_COUNT} hot wallet blocks don't reach back to this reservation, check the hot wallet history by hand`
		);
	}
	const sends = matchingSends(history, reservation);
	const recorded = await reservations.recordedSendHashes(
		sends.map((send) => send.hash)
	);
	return sends.map((entry) => ({ entry, recorded: recorded.has(entry.hash) }));
}

function printCandidates(
	reservation: ReservedRefund,
	candidates: Candidate[]
): void {
	if (candidates.length === 0 && !isOldEnough(reservation.reservedAt)) {
		console.log(
			"No matching send yet, but the reservation is recent and its send may still be running: check again once it shows as stuck"
		);
		return;
	}
	if (candidates.length === 0) {
		console.log(
			`No matching send in the last ${HISTORY_COUNT} hot wallet blocks: the refund was not sent. Make sure wban-api isn't still processing it (wban-ledger-pod.sh <chain> inflight), send it from the hot wallet by hand, then confirm it with that block hash`
		);
		return;
	}
	candidates.forEach(({ entry, recorded }) =>
		console.log(
			`  ${entry.hash} at ${new Date(
				entry.localTimestamp * 1_000
			).toISOString()}${recorded ? " (already recorded elsewhere)" : ""}`
		)
	);
}

async function list(reservations: RefundReservations): Promise<void> {
	const reserved = await reservations.list();
	if (reserved.length === 0) {
		console.log("No reserved refunds");
		return;
	}
	reserved.forEach((refund) => console.log(summary(refund)));
}

async function inspect(
	reservations: RefundReservations,
	depositHash: string | undefined
): Promise<void> {
	const reservation = await reservationOrFail(reservations, depositHash);
	console.log(summary(reservation));
	console.log("Matching sends from the hot wallet:");
	printCandidates(reservation, await candidateSends(reservations, reservation));
}

async function confirm(
	reservations: RefundReservations,
	depositHash: string | undefined,
	hash: string | undefined
): Promise<void> {
	const reservation = await reservationOrFail(reservations, depositHash);
	const candidates = await candidateSends(reservations, reservation);
	const candidate = candidates.find(
		({ entry }) => entry.hash === hash?.toUpperCase()
	);
	if (!candidate) {
		printCandidates(reservation, candidates);
		throw new Error(
			`${hash} is not a matching send from the hot wallet for ${summary(
				reservation
			)}`
		);
	}
	if (candidate.recorded) {
		throw new Error(`${hash} is already recorded for another send`);
	}
	assertNoLookalike(await reservations.otherOpenSends(reservation));
	await reservations.confirm(reservation.depositHash, candidate.entry.hash);
	console.log(`Confirmed ${summary(reservation)} with ${candidate.entry.hash}`);
}

async function run(args: string[]): Promise<void> {
	const [command, depositHash, hash] = args;
	const pool = new Pool(poolConfigFromEnv());
	const reservations = new RefundReservations(createDatabase(pool));
	try {
		switch (command) {
			case "list":
				return await list(reservations);
			case "inspect":
				return await inspect(reservations, depositHash);
			case "confirm":
				return await confirm(reservations, depositHash, hash);
			default:
				console.log(USAGE);
				return undefined;
		}
	} finally {
		await pool.end();
	}
}

run(process.argv.slice(2)).catch((err) => {
	console.error(safeErrorMessage(err));
	process.exit(1);
});

import { STUCK_AFTER_MINUTES } from "../storage/postgres/WithdrawalReservations";
import { OpenSend } from "../storage/postgres/recordedSends";

export function isOldEnough(reservedAt: Date, now = Date.now()): boolean {
	return now - reservedAt.getTime() >= STUCK_AFTER_MINUTES * 60_000;
}

export function assertOldEnough(reservedAt: Date, now = Date.now()): void {
	if (isOldEnough(reservedAt, now)) {
		return;
	}
	throw new Error(
		`Reserved at ${reservedAt.toISOString()}, its send may still be running: wait until the reservation is ${STUCK_AFTER_MINUTES} minutes old`
	);
}

const describeOpenSend = (open: OpenSend) =>
	open.kind === "withdrawal"
		? `withdrawal #${open.id}`
		: `refund of deposit ${open.id}`;

export function assertNoLookalike(others: OpenSend[]): void {
	if (others.length === 0) {
		return;
	}
	throw new Error(
		`${others
			.map(describeOpenSend)
			.join(
				", "
			)} also waits for a send of the same amount to the same address, so their sends can't be told apart: resolve them by hand`
	);
}

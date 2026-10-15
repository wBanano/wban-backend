import chai from "chai";
import {
	assertNoLookalike,
	assertOldEnough,
	isOldEnough,
} from "../../src/tools/reservationChecks";

const { expect } = chai;

describe("Reservation checks", () => {
	const now = Date.parse("2026-10-15T12:00:00Z");

	it("treats a reservation as stuck once it is 10 minutes old", () => {
		expect(isOldEnough(new Date(now - 9 * 60_000), now)).to.equal(false);
		expect(isOldEnough(new Date(now - 10 * 60_000), now)).to.equal(true);
		expect(() => assertOldEnough(new Date(now - 60_000), now)).to.throw(
			"its send may still be running"
		);
	});

	it("refuses when another open send looks the same", () => {
		expect(() => assertNoLookalike([])).to.not.throw();
		expect(() =>
			assertNoLookalike([
				{ kind: "withdrawal", id: "7" },
				{ kind: "refund", id: "D1" },
			])
		).to.throw("withdrawal #7, refund of deposit D1 also waits");
	});
});

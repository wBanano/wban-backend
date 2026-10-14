import chai from "chai";
import isPositiveAmount from "../../src/models/requests/positiveAmount";

const { expect } = chai;

describe("Positive amount", () => {
	[10, 0.5, "10", "0.01"].forEach((amount) =>
		it(`accepts ${JSON.stringify(amount)}`, () => {
			expect(isPositiveAmount(amount)).to.equal(true);
		})
	);

	[0, -1, "0", "", "abc", NaN, Infinity, null, undefined, true, {}].forEach(
		(amount) =>
			it(`rejects ${String(amount)}`, () => {
				expect(isPositiveAmount(amount)).to.equal(false);
			})
	);
});

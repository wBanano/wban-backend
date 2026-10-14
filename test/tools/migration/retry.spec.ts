import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { retrying } from "../../../src/tools/migration/retry";

const { expect } = chai;
chai.use(chaiAsPromised);

describe("Lookup retries", () => {
	const quietly = async <T>(work: () => Promise<T>): Promise<T> => {
		const { error } = console;
		console.error = () => undefined;
		try {
			return await work();
		} finally {
			console.error = error;
		}
	};

	it("retries a failing lookup until it answers", async () => {
		let calls = 0;
		const flaky = async () => {
			calls += 1;
			if (calls < 3) {
				throw new Error("Backend unavailable");
			}
			return "receipt";
		};
		const result = await quietly(() =>
			retrying(flaky, { attempts: 3, firstDelayMs: 1, label: "test" })
		);
		expect([result, calls]).to.deep.equal(["receipt", 3]);
	});

	it("gives up with the last error after the last attempt", async () => {
		let calls = 0;
		const down = async () => {
			calls += 1;
			throw new Error(`failure ${calls}`);
		};
		await expect(
			quietly(() =>
				retrying(down, { attempts: 2, firstDelayMs: 1, label: "test" })
			)
		).to.be.rejectedWith("failure 2");
		expect(calls).to.equal(2);
	});
});

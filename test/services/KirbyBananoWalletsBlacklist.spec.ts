import { expect } from "chai";
import { BananoWalletsBlacklist } from "../../src/services/BananoWalletsBlacklist";
import KirbyBananoWalletsBlacklist from "../../src/services/KirbyBananoWalletsBlacklist";

describe("Banano Wallets Blacklist", () => {
	let svc: BananoWalletsBlacklist = new KirbyBananoWalletsBlacklist();

	it("Checks that CoinEx hot wallet is blacklisted", async () => {
		const coinex = await svc.isBlacklisted(
			"ban_1nrcne47secz1hnm9syepdoob7t1r4xrhdzih3zohb1c3z178edd7b6ygc4x"
		);
		expect(coinex).to.not.be.undefined;
		if (!coinex) {
			throw Error();
		}
		expect(coinex.alias).to.equal("CoinEx OLD");
		expect(coinex.address).to.equal(
			"ban_1nrcne47secz1hnm9syepdoob7t1r4xrhdzih3zohb1c3z178edd7b6ygc4x"
		);
	});

	it("Checks that wBAN donations wallet is not blacklisted", async () => {
		expect(
			await svc.isBlacklisted(
				"ban_1wban1mwe1ywc7dtknaqdbog5g3ah333acmq8qxo5anibjqe4fqz9x3xz6ky"
			)
		).to.be.undefined;
	});
});

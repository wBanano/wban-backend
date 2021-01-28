import chai from "chai";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import config from "../../src/config";
import { UsersDepositsService } from "../../src/services/UsersDepositsService";
import { Service } from "../../src/services/Service";

const { expect } = chai;
chai.use(sinonChai);

describe("Main Service", () => {
	let svc: Service = null;
	let depositsService: UsersDepositsService = null;

	beforeEach(async () => {
		depositsService = sinon.stubInterface<UsersDepositsService>();
		svc = new Service(depositsService);
	});

	it("Checks properly signatures", async () => {
		const amount = "29.0";
		const from =
			"ban_1o3k8868n6d1679iz6fcz1wwwaq9hek4ykd58wsj5bozb8gkf38pm7njrr1o";
		const bscWallet = "0x69fd25b60da76afd10d8fc7306f10f2934fc4829";
		const signature =
			"0x8b828450dbc98d25c13443f91338863bb319266d3d9e92fdf5e1eb4d9b241b85704dcabe560382790435510b33b2990057d3325fb992e9f29b5c9ffede6b5e121c";
		expect(
			svc.checkSignature(
				bscWallet,
				signature,
				`Swap ${amount} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		).to.be.true;
		expect(
			svc.checkSignature(
				"0x59fd25b60da76afd10d8fc7306f10f2934fc4828",
				signature,
				`Swap ${amount} BAN for wBAN with BAN I deposited from my wallet "${from}"`
			)
		).to.be.false;
	});
});

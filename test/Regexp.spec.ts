import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import * as sinon from "ts-sinon";
import sinonChai from "sinon-chai";
import { UsersDepositsService } from "../src/services/UsersDepositsService";
import { Banano } from "../src/Banano";
import { BigNumber, ethers } from "ethers";
import ProcessingQueue from "../src/services/queuing/ProcessingQueue";
import config from "../src/config";

const { expect } = chai;

chai.use(sinonChai);
chai.use(chaiAsPromised);

describe("Regexp", () => {

	it("Should extra BAN addy from Redis key", async () => {
		const blockchainAddress = '0xc2b286fb1141151928c86a9131b6bbfb7ab42cff';
		const redisKey = `claims:ban_1wban1mwe1ywc7dtknaqdbog5g3ah333acmq8qxo5anibjqe4fqz9x3xz6ky:${blockchainAddress}`;

		const regexp = new RegExp(`claims:(?<banAddress>.*):${blockchainAddress.toLowerCase()}`, 'g');
		const results: RegExpExecArray | null = regexp.exec(redisKey);
		const banAddress = results?.groups?.banAddress;

		expect(banAddress).to.equal("ban_1wban1mwe1ywc7dtknaqdbog5g3ah333acmq8qxo5anibjqe4fqz9x3xz6ky");
	});

});

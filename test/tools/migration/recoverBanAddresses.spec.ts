import chai from "chai";
import { ethers } from "ethers";
// eslint-disable-next-line camelcase
import { WBANToken__factory } from "wban-smart-contract";
import {
	TransactionReceipts,
	banAddressFromChain,
	recoverBanAddresses,
} from "../../../src/tools/migration/recoverBanAddresses";

const { expect } = chai;

const CONTRACT = "0x00000000000000000000000000000000000000aa";
const FROM = "0xabc0000000000000000000000000000000000001";
const AMOUNT = ethers.utils.parseEther("2").toString();

function swapToBanLog(
	from: string,
	banAddress: string,
	amount: string,
	address = CONTRACT
) {
	const wban = WBANToken__factory.createInterface();
	const encoded = wban.encodeEventLog(wban.getEvent("SwapToBan"), [
		from,
		banAddress,
		amount,
	]);
	return { address, ...encoded } as ethers.providers.Log;
}

function receipts(logs: ethers.providers.Log[]): TransactionReceipts {
	return {
		getTransactionReceipt: async () =>
			({ logs } as ethers.providers.TransactionReceipt),
	};
}

describe("Unwrap BAN address recovery", () => {
	const unwrap = { hash: "0xtx", blockchainAddress: FROM, amount: AMOUNT };

	it("reads the BAN address from the SwapToBan event of the transaction", async () => {
		const lookup = receipts([swapToBanLog(FROM, "BAN_1Alice", AMOUNT)]);
		expect(await banAddressFromChain(lookup, CONTRACT, unwrap)).to.equal(
			"ban_1alice"
		);
		expect(await recoverBanAddresses(lookup, CONTRACT, [unwrap])).to.deep.equal(
			new Map([["0xtx", "ban_1alice"]])
		);
	});

	it("ignores events of other contracts, senders or amounts", async () => {
		const lookup = receipts([
			swapToBanLog(
				FROM,
				"ban_1x",
				AMOUNT,
				"0x00000000000000000000000000000000000000bb"
			),
			swapToBanLog(
				"0xdef0000000000000000000000000000000000002",
				"ban_1y",
				AMOUNT
			),
			swapToBanLog(FROM, "ban_1z", "1"),
		]);
		expect(await banAddressFromChain(lookup, CONTRACT, unwrap)).to.equal(
			undefined
		);
	});

	it("gives up when the transaction has two matching events", async () => {
		const lookup = receipts([
			swapToBanLog(FROM, "ban_1x", AMOUNT),
			swapToBanLog(FROM, "ban_1y", AMOUNT),
		]);
		expect(await banAddressFromChain(lookup, CONTRACT, unwrap)).to.equal(
			undefined
		);
	});
});

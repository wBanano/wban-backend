import chai from "chai";
import { BigNumber, ethers } from "ethers";
import { isPermitSignedByOwner, permitDigest } from "../../src/services/permit";

const { expect } = chai;

describe("wBAN permits", () => {
	const owner = ethers.Wallet.createRandom();
	const domain = {
		name: "Wrapped Banano",
		version: "1",
		chainId: 137,
		verifyingContract: "0x00000000000000000000000000000000000000aa",
	};
	const types = {
		Permit: [
			{ name: "owner", type: "address" },
			{ name: "spender", type: "address" },
			{ name: "value", type: "uint256" },
			{ name: "nonce", type: "uint256" },
			{ name: "deadline", type: "uint256" },
		],
	};
	const permit = {
		owner: owner.address,
		spender: "0x00000000000000000000000000000000000000bb",
		value: ethers.utils.parseEther("1000"),
		nonce: BigNumber.from(3),
		deadline: BigNumber.from(1_800_000_000),
	};
	// eslint-disable-next-line no-underscore-dangle
	const domainSeparator = ethers.utils._TypedDataEncoder.hashDomain(domain);

	it("hashes a permit like EIP-712", () => {
		expect(permitDigest(domainSeparator, permit)).to.equal(
			// eslint-disable-next-line no-underscore-dangle
			ethers.utils._TypedDataEncoder.hash(domain, types, permit)
		);
	});

	it("accepts only a permit signed by its owner for these exact terms", async () => {
		// eslint-disable-next-line no-underscore-dangle
		const signature = await owner._signTypedData(domain, types, permit);
		expect(isPermitSignedByOwner(domainSeparator, permit, signature)).to.equal(
			true
		);
		expect(
			isPermitSignedByOwner(
				domainSeparator,
				{ ...permit, value: permit.value.add(1) },
				signature
			)
		).to.equal(false);
		expect(
			isPermitSignedByOwner(
				domainSeparator,
				{ ...permit, nonce: permit.nonce.add(1) },
				signature
			)
		).to.equal(false);
		const stranger = ethers.Wallet.createRandom();
		// eslint-disable-next-line no-underscore-dangle
		const forged = await stranger._signTypedData(domain, types, permit);
		expect(isPermitSignedByOwner(domainSeparator, permit, forged)).to.equal(
			false
		);
		expect(isPermitSignedByOwner(domainSeparator, permit, "0x1234")).to.equal(
			false
		);
	});
});

import { BigNumber, ethers } from "ethers";

const PERMIT_TYPEHASH = ethers.utils.id(
	"Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
);

export type PermitApproval = {
	owner: string;
	spender: string;
	value: BigNumber;
	nonce: BigNumber;
	deadline: BigNumber;
};

export function permitDigest(
	domainSeparator: string,
	permit: PermitApproval
): string {
	const structHash = ethers.utils.keccak256(
		ethers.utils.defaultAbiCoder.encode(
			["bytes32", "address", "address", "uint256", "uint256", "uint256"],
			[
				PERMIT_TYPEHASH,
				permit.owner,
				permit.spender,
				permit.value,
				permit.nonce,
				permit.deadline,
			]
		)
	);
	return ethers.utils.keccak256(
		ethers.utils.solidityPack(
			["string", "bytes32", "bytes32"],
			["\x19\x01", domainSeparator, structHash]
		)
	);
}

export function isPermitSignedByOwner(
	domainSeparator: string,
	permit: PermitApproval,
	signature: string
): boolean {
	try {
		const signer = ethers.utils.recoverAddress(
			permitDigest(domainSeparator, permit),
			signature
		);
		return signer === ethers.utils.getAddress(permit.owner);
	} catch {
		return false;
	}
}

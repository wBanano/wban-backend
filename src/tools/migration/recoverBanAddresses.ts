import { ethers } from "ethers";
// eslint-disable-next-line camelcase
import { WBANToken__factory } from "wban-smart-contract";
import { LedgerSnapshot } from "./snapshot";

export type TransactionReceipts = {
	getTransactionReceipt(
		hash: string
	): Promise<ethers.providers.TransactionReceipt | null>;
};

export type UnwrapWithoutBanAddress = {
	hash: string;
	blockchainAddress: string;
	amount: string;
};

export function unwrapsWithoutBanAddress(
	snapshot: LedgerSnapshot
): UnwrapWithoutBanAddress[] {
	const unwraps: UnwrapWithoutBanAddress[] = [];
	snapshot.history.swap_to_ban.forEach((members, blockchainAddress) =>
		members.forEach(({ member }) => {
			const audit = snapshot.audits.get(member);
			if (!audit || audit.banAddress) {
				return;
			}
			unwraps.push({ hash: member, blockchainAddress, amount: audit.amount });
		})
	);
	return unwraps;
}

export async function banAddressFromChain(
	receipts: TransactionReceipts,
	contractAddress: string,
	unwrap: UnwrapWithoutBanAddress
): Promise<string | undefined> {
	// eslint-disable-next-line camelcase
	const wban = WBANToken__factory.createInterface();
	const receipt = await receipts.getTransactionReceipt(unwrap.hash);
	const matches = (receipt?.logs ?? [])
		.filter(
			(log) => log.address.toLowerCase() === contractAddress.toLowerCase()
		)
		.map((log) => {
			try {
				return wban.parseLog(log);
			} catch {
				return undefined;
			}
		})
		.filter(
			(event) =>
				event?.name === "SwapToBan" &&
				String(event.args.from).toLowerCase() === unwrap.blockchainAddress &&
				event.args.amount.toString() === unwrap.amount
		);
	if (matches.length !== 1) {
		return undefined;
	}
	return String(matches[0]?.args.banAddress).toLowerCase();
}

export async function recoverBanAddresses(
	receipts: TransactionReceipts,
	contractAddress: string,
	unwraps: UnwrapWithoutBanAddress[]
): Promise<Map<string, string>> {
	const recovered = new Map<string, string>();
	// eslint-disable-next-line no-restricted-syntax
	for (const unwrap of unwraps) {
		// eslint-disable-next-line no-await-in-loop
		const banAddress = await banAddressFromChain(
			receipts,
			contractAddress,
			unwrap
		);
		if (banAddress) {
			recovered.set(unwrap.hash, banAddress);
		}
	}
	return recovered;
}

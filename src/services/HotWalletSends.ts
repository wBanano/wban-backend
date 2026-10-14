import * as banano from "@bananocoin/bananojs";
import { BigNumber } from "ethers";
import config from "../ledgerConfig";
import { ReservedWithdrawal } from "../storage/postgres/WithdrawalReservations";

export type AccountHistoryEntry = {
	type: string;
	account: string;
	amount: string;
	hash: string;
	localTimestamp: number;
};

type RpcHistoryEntry = Omit<AccountHistoryEntry, "localTimestamp"> & {
	// eslint-disable-next-line camelcase
	local_timestamp: string;
};

const RAW_PER_LEDGER_UNIT = BigNumber.from(10).pow(11);

const CLOCK_SLACK_SECONDS = 60;

export function rawAmount(ledgerAmount: string): string {
	return BigNumber.from(ledgerAmount).mul(RAW_PER_LEDGER_UNIT).toString();
}

export function matchingSends(
	history: AccountHistoryEntry[],
	reservation: ReservedWithdrawal
): AccountHistoryEntry[] {
	const raw = rawAmount(reservation.amount);
	const notBefore =
		Math.floor(reservation.reservedAt.getTime() / 1_000) - CLOCK_SLACK_SECONDS;
	return history.filter(
		(entry) =>
			entry.type === "send" &&
			entry.account === reservation.banAddress &&
			entry.amount === raw &&
			entry.localTimestamp >= notBefore
	);
}

export async function fetchHotWalletHistory(
	count: number
): Promise<AccountHistoryEntry[]> {
	banano.setBananodeApiUrl(config.BananoRPCAPI);
	const response = await banano.getAccountHistory(
		config.BananoUsersDepositsHotWallet,
		String(count)
	);
	if (response?.error) {
		throw new Error(`account_history failed: ${response.error}`);
	}
	const history: RpcHistoryEntry[] = response?.history ?? [];
	return history.map(({ type, account, amount, hash, ...rest }) => ({
		type,
		account,
		amount,
		hash,
		localTimestamp: Number(rest.local_timestamp),
	}));
}

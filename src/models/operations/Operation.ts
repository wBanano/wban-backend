import BananoUserDeposit from "./BananoUserDeposit";
import BananoUserWithdrawal from "./BananoUserWithdrawal";
import SwapBanToWBAN from "./SwapBanToWBAN";
import SwapWBANToBan from "./SwapWBANToBan";
import GaslessSwap from "./GaslessSwap";

export declare type Operation =
	| BananoUserDeposit
	| BananoUserWithdrawal
	| SwapBanToWBAN
	| SwapWBANToBan
	| GaslessSwap;

export enum OperationsNames {
	BananoDeposit = "banano-deposit",
	BananoWithdrawal = "banano-withdrawal",
	SwapToWBAN = "swap-ban-to-wban",
	SwapToBAN = "swap-wban-to-ban",
	GaslessSwapToETH = "gasless-swap",
}

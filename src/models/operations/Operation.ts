import BananoUserDeposit from "./BananoUserDeposit";
import BananoUserWithdrawal from "./BananoUserWithdrawal";
import SwapBanToWBAN from "./SwapBanToWBAN";
import SwapWBANToBan from "./SwapWBANToBan";

export declare type Operation =
	| BananoUserDeposit
	| BananoUserWithdrawal
	| SwapBanToWBAN
	| SwapWBANToBan;

export enum OperationsNames {
	BananoDeposit = "banano-deposit",
	BananoWithdrawal = "banano-withdrawal",
	SwapToWBAN = "swap-ban-to-wban",
	SwapToBAN = "swap-wban-to-ban",
}

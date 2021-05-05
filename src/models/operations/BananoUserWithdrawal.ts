import Withdrawal from "./Withdrawal";

declare type BananoUserWithdrawal = Withdrawal & {
	signature: string;
	attempt: number;
};

export default BananoUserWithdrawal;

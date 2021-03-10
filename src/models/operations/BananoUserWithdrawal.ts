import Withdrawal from "./Withdrawal";

declare type BananoUserWithdrawal = Withdrawal & {
	signature: string;
};

export default BananoUserWithdrawal;

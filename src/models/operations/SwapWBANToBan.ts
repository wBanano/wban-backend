import Withdrawal from "./Withdrawal";

declare type SwapWBANToBan = Withdrawal & {
	wbanBalance: string;
	hash: string;
};

export default SwapWBANToBan;

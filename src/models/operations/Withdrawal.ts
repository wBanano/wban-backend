declare type Withdrawal = {
	banWallet: string;
	bscWallet: string;
	amount: string;
	timestamp: number;
	checkUserBalance: boolean;
};

export default Withdrawal;

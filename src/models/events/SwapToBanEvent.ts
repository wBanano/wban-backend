import { BigNumber } from "ethers";

interface SwapToBanEvent {
	from: string;
	banAddress: string;
	amount: BigNumber;
	hash: string;
}

export default SwapToBanEvent;

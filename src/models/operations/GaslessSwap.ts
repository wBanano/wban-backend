import { BigNumber } from "ethers";

declare type Permit = {
	amount: string; // amount of wBAN to swap
	deadline: number; // permit deadline
	signature: string; // Permit signature to spend wBAN
};

declare type GaslessSwap = {
	recipient: string; // blockchain address of the user requesting the gasless swap
	permit: Permit;
	gasLimit: number;
	swapCallData: string; // the 0x `data` field from the API response
};

export default GaslessSwap;

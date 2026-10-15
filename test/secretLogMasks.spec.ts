import chai from "chai";
import { ethers } from "ethers";
import { Logger } from "tslog";
import config from "../src/config";
import secretLogMasks from "../src/secretLogMasks";

const { expect } = chai;

const KEY = "bm_live_0123456789abcdef";
const RPC_URL = `https://rpc-bsc.example.io?authorization=${KEY}`;

const rpcError = (url: string): Error =>
	new ethers.utils.Logger("web/5.7.1").makeError(
		"missing response",
		ethers.utils.Logger.errors.SERVER_ERROR,
		{ url, requestMethod: "POST" }
	);

function capturing(parent: Logger): { log: Logger; printed: () => string } {
	const lines: string[] = [];
	const sink = { write: (text: string) => lines.push(text) };
	return {
		log: parent.getChildLogger({
			minLevel: "silly",
			stdOut: sink,
			stdErr: sink,
		}),
		printed: () => lines.join(""),
	};
}

describe("Secret log masks", () => {
	it("prints the RPC key when nothing masks it", () => {
		const { log, printed } = capturing(new Logger());
		log.error("Can't request Blockchain balance", rpcError(RPC_URL));
		expect(printed()).to.include(KEY);
	});

	it("masks the configured RPC URL in an ethers error", () => {
		const masked = new Logger({
			maskAnyRegEx: secretLogMasks({ BC_JSON_RPC_URL: RPC_URL }),
		});
		const { log, printed } = capturing(masked);
		log.error("Can't request Blockchain balance", rpcError(RPC_URL));
		expect(printed()).to.not.include(KEY);
		expect(printed()).to.not.include("rpc-bsc.example.io");
		expect(printed()).to.include("[***]");
	});

	it("masks credentials in URLs it was not configured with", () => {
		const { log, printed } = capturing(
			new Logger({ maskAnyRegEx: secretLogMasks({}) })
		);
		log.error(
			"Can't fetch gas price",
			rpcError("https://other.example/rpc?apikey=s3cr3tvalue&chain=1")
		);
		expect(printed()).to.not.include("s3cr3tvalue");
		expect(printed()).to.include("apikey=[***]&chain=1");
	});

	it("leaves settings too short to mask safely alone", () => {
		const { log, printed } = capturing(
			new Logger({ maskAnyRegEx: secretLogMasks({ REDIS_PASSWORD: "abc" }) })
		);
		log.info("abcdef");
		expect(printed()).to.include("abcdef");
	});

	it("masks for every module through the app logger", () => {
		const { log, printed } = capturing(config.Logger);
		log.error("Can't request Blockchain balance", rpcError(RPC_URL));
		expect(printed()).to.not.include(KEY);
	});
});

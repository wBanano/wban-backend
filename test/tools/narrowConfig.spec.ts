import chai from "chai";
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";

const { expect } = chai;

const ROOT = process.cwd();

const TOOL_ENTRIES = [
	"src/tools/migrate-redis-to-postgres.ts",
	"src/tools/db-migrate.ts",
	"src/tools/ledger-withdrawal.ts",
];

const TOOL_LIBRARIES = [
	"src/tools/migration/snapshot.ts",
	"src/tools/migration/plan.ts",
	"src/tools/migration/write.ts",
	"src/tools/migration/verify.ts",
	"src/tools/migration/report.ts",
	"src/tools/migration/recoverBanAddresses.ts",
	"src/tools/migration/recoverAudits.ts",
	"src/tools/migration/bananoNode.ts",
	"src/tools/migration/retry.ts",
	"src/tools/migration/safeErrorMessage.ts",
	"src/storage/postgres/database.ts",
	"src/storage/postgres/WithdrawalReservations.ts",
	"src/services/HotWalletSends.ts",
];

function localImports(file: string): string[] {
	return [
		...readFileSync(path.join(ROOT, file), "utf8").matchAll(
			/from "(\.[^"]+)"/g
		),
	].map(([, specifier]) => specifier);
}

describe("Ledger tools configuration", () => {
	it("never loads src/config.ts, which reads the seed and the keys", function loads() {
		this.timeout(60_000);
		const script = `
			${TOOL_LIBRARIES.map((file) => `require(${JSON.stringify(`./${file}`)});`).join(
				"\n"
			)}
			const loaded = Object.keys(require.cache).some((file) => file.endsWith("/src/config.ts"));
			process.stdout.write(String(loaded));
		`;
		const output = execFileSync(
			process.execPath,
			["-r", "ts-node/register/transpile-only", "-e", script],
			{ cwd: ROOT, encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } }
		);
		expect(output.trim().split("\n").pop()).to.equal("false");
	});

	it("keeps the tool entry points on the narrow configuration", () => {
		TOOL_ENTRIES.forEach((file) =>
			expect(localImports(file), file).to.not.include("../config")
		);
	});
});

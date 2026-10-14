import { Pool } from "pg";
import {
	chainIdentityFromConfig,
	createDatabase,
	migrateDatabase,
	poolConfigFromEnv,
} from "../storage/postgres/database";
import safeErrorMessage from "./migration/safeErrorMessage";

const run = async () => {
	const pool = new Pool(poolConfigFromEnv());
	try {
		const chain = chainIdentityFromConfig();
		await migrateDatabase(createDatabase(pool), chain);
		console.log(
			`Database migrated for ${chain.networkName} (chain id ${chain.chainId})`
		);
	} finally {
		await pool.end();
	}
};

run().catch((err) => {
	console.error(safeErrorMessage(err));
	process.exit(1);
});

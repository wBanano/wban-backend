import { Relayer, RelayerTransaction } from "defender-relay-client";
import config from "../config";

const list = async () => {
	const credentials = {
		apiKey: config.BlockchainRelayerApiKey,
		apiSecret: config.BlockchainRelayerSecretKey,
	};
	const relayer = new Relayer(credentials);
	/*
	const provider = new DefenderRelayProvider(credentials);
	this.relayerSigner = new DefenderRelaySigner(credentials, provider, {
		speed: "fast",
		validForSeconds: 300, // relayed transaction valid for 5 minutes
	});
	*/

	const relayedTransactions: RelayerTransaction[] = await relayer.list();
	console.log(relayedTransactions);
};

list();

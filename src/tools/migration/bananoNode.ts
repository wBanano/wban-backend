export type BananoBlock = {
	account: string;
	amount: string;
	confirmed?: string;
	subtype?: string;
	linkAsAccount?: string;
};

type NodeBlock = {
	/* eslint-disable camelcase */
	block_account: string;
	amount: string;
	confirmed?: string;
	subtype?: string;
	contents?: { link_as_account?: string };
	/* eslint-enable camelcase */
};

export type BananoNode = {
	blocksInfo(hashes: string[]): Promise<Map<string, BananoBlock>>;
};

const REQUEST_TIMEOUT_MS = 30_000;

export function bananoNodeUrl(host: string): string {
	return /^https?:\/\//.test(host) ? host : `http://${host}`;
}

export function bananoNodeRpc(host: string): BananoNode {
	const url = bananoNodeUrl(host);
	return {
		async blocksInfo(hashes) {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					action: "blocks_info",
					json_block: "true",
					include_not_found: "true",
					hashes,
				}),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!response.ok) {
				throw new Error(`Banano node answered HTTP ${response.status}`);
			}
			const body = await response.json();
			if (body.error) {
				throw new Error(`Banano node answered: ${body.error}`);
			}
			return new Map(
				Object.entries((body.blocks ?? {}) as Record<string, NodeBlock>).map(
					([hash, block]) => [
						hash,
						{
							account: block.block_account,
							amount: block.amount,
							confirmed: block.confirmed,
							subtype: block.subtype,
							linkAsAccount: block.contents?.link_as_account,
						},
					]
				)
			);
		},
	};
}

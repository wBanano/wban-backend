import { Response } from "express";
import SSEClient from "./SSEClient";
import SSEMessage from "./SSEMessage";

class SSEManager {
	private clients: Map<string, SSEClient>;

	constructor() {
		this.clients = new Map();
	}

	public open(clientId: string, context: Response): void {
		const client = new SSEClient(context);
		client.initialize();
		this.clients.set(clientId, client);
	}

	public delete(clientId: string): void {
		this.clients.delete(clientId);
	}

	public deleteAll(): void {
		this.clients.clear();
	}

	public unicast(clientId: string, message: SSEMessage): void {
		const client = this.clients.get(clientId);
		if (client) {
			client.send(message);
		}
	}

	public broadcast(message: SSEMessage): void {
		// eslint-disable-next-line no-restricted-syntax
		for (const [id] of this.clients) {
			this.unicast(id, message);
		}
	}

	public multicast(clientIds: string[], message: SSEMessage): void {
		// eslint-disable-next-line no-restricted-syntax
		for (const id of clientIds) {
			this.unicast(id, message);
		}
	}

	/**
	 * Returns the number of connected clients
	 * @function count
	 * @returns {number}
	 */
	public count(): number {
		return this.clients.size;
	}
}

export default SSEManager;

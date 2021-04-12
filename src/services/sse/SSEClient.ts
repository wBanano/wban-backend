import { Response } from "express";
import SSEMessage from "./SSEMessage";

class SSEClient {
	private context: Response;

	constructor(context: Response) {
		this.context = context;
	}

	/**
	 * Initialize connection with client
	 * @function initialize
	 */
	public initialize(): void {
		const headers = {
			"Content-Type": "text/event-stream",
			Connection: "keep-alive",
			"Cache-Control": "no-cache",
			"Access-Control-Allow-Origin": "*",
			"X-Accel-Buffering": "no",
		};
		this.context.writeHead(200, headers);
		this.send({
			type: "ping",
			data: "ping",
		});
	}

	public send(message: SSEMessage): void {
		const { id, type = "message", retry, data } = message;

		if (id) {
			this.context.write(`id: ${id}\n`);
		}
		if (type) {
			this.context.write(`event: ${type}\n`);
		}
		if (retry) {
			this.context.write(`retry: ${retry}\n`);
		}

		this.context.write(
			`data: ${typeof data === "object" ? JSON.stringify(data) : data}\n\n`
		);
	}
}

export default SSEClient;

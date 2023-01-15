import { SiweMessage } from "siwe";

declare module "express-session" {
	interface SessionData {
		nonce: string | null;
		siwe: SiweMessage | null;
	}
}

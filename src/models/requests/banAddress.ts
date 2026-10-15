const BAN_ADDRESS = /^ban_[13][13456789abcdefghijkmnopqrstuwxyz]{59}$/;

export default function isBanAddress(value: unknown): value is string {
	return typeof value === "string" && BAN_ADDRESS.test(value);
}

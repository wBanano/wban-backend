export default function isPositiveAmount(value: unknown): boolean {
	if (typeof value !== "number" && typeof value !== "string") {
		return false;
	}
	const amount = Number(value);
	return Number.isFinite(amount) && amount > 0;
}

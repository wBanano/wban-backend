import safeErrorMessage from "./safeErrorMessage";

export type RetryOptions = {
	attempts: number;
	firstDelayMs: number;
	label: string;
};

const pause = (ms: number) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

export async function retrying<T>(
	work: () => Promise<T>,
	options: RetryOptions,
	attempt = 1
): Promise<T> {
	try {
		return await work();
	} catch (err) {
		if (attempt >= options.attempts) {
			throw err;
		}
		const delayMs = options.firstDelayMs * 2 ** (attempt - 1);
		console.error(
			`${options.label} failed (${safeErrorMessage(
				err
			)}), retry ${attempt} of ${options.attempts - 1} in ${delayMs / 1_000} s`
		);
		await pause(delayMs);
		return retrying(work, options, attempt + 1);
	}
}

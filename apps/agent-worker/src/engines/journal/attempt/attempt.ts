import { NodeError } from "../../nodeError";
import { RunCanceledError } from "../runCanceled";

const FIRST_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export interface AttemptArgs<T> {
	run: () => Promise<T>;
	/** Total tries, counting the first. */
	attempts: number;
	/** Longest single try. */
	timeoutMs: number;
	sleep: (ms: number) => Promise<void>;
	signal?: AbortSignal;
}

/**
 * Runs `run` up to `attempts` times with exponential backoff. A try that
 * outlasts `timeoutMs` fails with a timed-out NodeError. A NodeError that is
 * not retryable ends the loop at once. An abort ends it with RunCanceledError.
 */
export async function attempt<T>(args: AttemptArgs<T>): Promise<T> {
	for (let tried = 1; ; tried++) {
		if (args.signal?.aborted) throw new RunCanceledError();
		try {
			return await guarded({
				promise: Promise.resolve().then(args.run),
				timeoutMs: args.timeoutMs,
				signal: args.signal,
			});
		} catch (error) {
			if (error instanceof RunCanceledError) throw error;
			if (error instanceof NodeError && !error.retryable) throw error;
			if (tried >= args.attempts) throw error;
			await guarded({
				promise: args.sleep(backoffMs(tried)),
				timeoutMs: Number.POSITIVE_INFINITY,
				signal: args.signal,
			});
		}
	}
}

function backoffMs(tried: number): number {
	return Math.min(FIRST_BACKOFF_MS * 2 ** (tried - 1), MAX_BACKOFF_MS);
}

function guarded<T>(args: {
	promise: Promise<T>;
	timeoutMs: number;
	signal?: AbortSignal;
}): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(new RunCanceledError());
		const timer = Number.isFinite(args.timeoutMs)
			? setTimeout(
					() =>
						reject(
							new NodeError({
								message: `Timed out after ${args.timeoutMs} ms`,
								code: "TimedOut",
								retryable: true,
								timedOut: true,
							}),
						),
					args.timeoutMs,
				)
			: undefined;
		args.signal?.addEventListener("abort", onAbort, { once: true });
		args.promise.then(resolve, reject).finally(() => {
			clearTimeout(timer);
			args.signal?.removeEventListener("abort", onAbort);
		});
	});
}

import { NodeError } from "../../nodeError";

export type ChunkResult<T> = { done: true; value: T } | { done: false };

/**
 * Runs bounded poll calls until one is done. Time used is the sum of the
 * budgets, so a replay counts the same as the first run.
 */
export async function pollInChunks<T>(args: {
	totalMs: number;
	chunkMs: number;
	label: string;
	poll: (chunk: { budgetMs: number; index: number }) => Promise<ChunkResult<T>>;
}): Promise<T> {
	let usedMs = 0;
	for (let index = 0; usedMs < args.totalMs; index++) {
		const budgetMs = Math.min(args.chunkMs, args.totalMs - usedMs);
		const result = await args.poll({ budgetMs, index });
		if (result.done) return result.value;
		usedMs += budgetMs;
	}
	throw new NodeError({
		message: `${args.label} did not finish within ${Math.round(args.totalMs / 60_000)} minutes.`,
		code: "NodeTimedOut",
		retryable: false,
		timedOut: true,
	});
}

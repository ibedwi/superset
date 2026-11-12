import type { WorkflowRunActivities } from "../../../activities/workflowActivities";
import type { WorkflowApi } from "../../../clients/workflowApi";
import type {
	ActivityInput,
	ActivityName,
	ActivityOutput,
	CallOptions,
	DurableContext,
} from "../../durableContext";
import { attempt } from "../attempt";
import { RunCanceledError } from "../runCanceled";

const SAVE = { attempts: 5, timeoutMs: 30_000 };

export type JournalApi = Pick<
	WorkflowApi,
	"loadCheckpoints" | "saveCheckpoint"
>;

/**
 * A context that stores every finished operation in the run's checkpoints, so
 * a process that starts the run again skips the work already done.
 */
export async function createJournaledContext(args: {
	api: JournalApi;
	activities: WorkflowRunActivities;
	runId: string;
	signal: AbortSignal;
	sleep: (ms: number) => Promise<void>;
	pollChunkMs: number;
	now?: () => number;
}): Promise<DurableContext> {
	const { api, runId, signal } = args;
	const now = args.now ?? Date.now;
	const stored = new Map<string, unknown>(
		(await api.loadCheckpoints({ runId })).map((row) => [row.key, row.result]),
	);

	const save = async (key: string, result: unknown) => {
		await attempt({
			run: () => api.saveCheckpoint({ runId, key, result }),
			sleep: args.sleep,
			signal,
			...SAVE,
		});
		stored.set(key, result);
	};

	return {
		pollChunkMs: args.pollChunkMs,
		isCancellation: (error) => error instanceof RunCanceledError,

		async call<K extends ActivityName>(
			name: K,
			input: ActivityInput<K>,
			options: CallOptions,
		): Promise<ActivityOutput<K>> {
			if (signal.aborted) throw new RunCanceledError();
			if (stored.has(options.key)) {
				return stored.get(options.key) as ActivityOutput<K>;
			}
			const activity = args.activities[name] as (
				input: ActivityInput<K>,
			) => Promise<ActivityOutput<K>>;
			const result = await attempt({
				run: () => activity(input),
				attempts: options.attempts,
				timeoutMs: options.timeoutMs,
				sleep: args.sleep,
				signal,
			});
			await save(options.key, result ?? null);
			return result;
		},

		async sleep(key, ms) {
			if (signal.aborted) throw new RunCanceledError();
			const known = stored.get(key);
			const wakeAt = typeof known === "number" ? known : now() + ms;
			if (typeof known !== "number") await save(key, wakeAt);
			const remaining = wakeAt - now();
			if (remaining <= 0) return;
			await attempt({
				run: () => args.sleep(remaining),
				attempts: 1,
				timeoutMs: Number.POSITIVE_INFINITY,
				signal,
				sleep: args.sleep,
			});
		},
	};
}

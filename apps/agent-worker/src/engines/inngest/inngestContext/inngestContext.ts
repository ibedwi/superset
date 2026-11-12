import { NonRetriableError, StepError } from "inngest";
import type { WorkflowRunActivities } from "../../../activities/workflowActivities";
import type {
	ActivityInput,
	ActivityName,
	ActivityOutput,
	CallOptions,
	DurableContext,
} from "../../durableContext";
import { attempt } from "../../journal";
import { decodeStepFailure, encodeStepFailure } from "../stepFailure";

const POLL_CHUNK_MS = 30 * 60_000;

export interface InngestStep {
	run(id: string, handler: () => Promise<unknown>): Promise<unknown>;
	sleep(id: string, ms: number): Promise<void>;
}

const realSleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Each operation is one Inngest step. The attempt loop runs inside the step
 * handler and gives up with NonRetriableError, so Inngest's own retries cover
 * only a lost worker.
 */
export function createInngestContext(args: {
	step: InngestStep;
	activities: WorkflowRunActivities;
	sleep?: (ms: number) => Promise<void>;
}): DurableContext {
	const sleep = args.sleep ?? realSleep;
	return {
		pollChunkMs: POLL_CHUNK_MS,
		isCancellation: () => false,

		async call<K extends ActivityName>(
			name: K,
			input: ActivityInput<K>,
			options: CallOptions,
		): Promise<ActivityOutput<K>> {
			const activity = args.activities[name] as (
				input: ActivityInput<K>,
			) => Promise<ActivityOutput<K>>;
			try {
				const result = await args.step.run(options.key, async () => {
					try {
						return (
							(await attempt({
								run: () => activity(input),
								attempts: options.attempts,
								timeoutMs: options.timeoutMs,
								sleep,
							})) ?? null
						);
					} catch (error) {
						throw new NonRetriableError(encodeStepFailure(error), {
							cause: error,
						});
					}
				});
				return result as ActivityOutput<K>;
			} catch (error) {
				if (error instanceof StepError || error instanceof NonRetriableError) {
					throw decodeStepFailure(error);
				}
				throw error;
			}
		},

		sleep: (key, ms) => args.step.sleep(key, ms),
	};
}

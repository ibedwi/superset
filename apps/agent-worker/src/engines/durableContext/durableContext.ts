import type { WorkflowRunActivities } from "../../activities/workflowActivities";

export interface CallOptions {
	/** Unique within the run and the same on every replay. */
	key: string;
	/** Longest single try. */
	timeoutMs: number;
	/** Total tries, counting the first. */
	attempts: number;
}

export type ActivityName = keyof WorkflowRunActivities;
export type ActivityInput<K extends ActivityName> = Parameters<
	WorkflowRunActivities[K]
>[0];
export type ActivityOutput<K extends ActivityName> = Awaited<
	ReturnType<WorkflowRunActivities[K]>
>;

export interface DurableContext {
	call<K extends ActivityName>(
		name: K,
		input: ActivityInput<K>,
		options: CallOptions,
	): Promise<ActivityOutput<K>>;
	sleep(key: string, ms: number): Promise<void>;
	isCancellation(error: unknown): boolean;
	/** Longest single poll call this engine allows. */
	readonly pollChunkMs: number;
}

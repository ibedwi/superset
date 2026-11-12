import {
	ActivityCancellationType,
	ActivityFailure,
	type ActivityOptions,
	ApplicationFailure,
	isCancellation,
	proxyActivities,
	sleep,
} from "@temporalio/workflow";
import type { WorkflowRunActivities } from "../../../activities/workflowActivities";
import type {
	ActivityInput,
	ActivityName,
	ActivityOutput,
	CallOptions,
	DurableContext,
} from "../../durableContext";
import { NodeError } from "../../nodeError";

const POLL_CHUNK_MS = 15 * 60_000;
const POLL_ACTIVITIES: ReadonlySet<ActivityName> = new Set([
	"awaitAgentNode",
	"pollCliNode",
]);

function activityOptions(
	name: ActivityName,
	options: CallOptions,
): ActivityOptions {
	const base: ActivityOptions = {
		startToCloseTimeout: options.timeoutMs,
		retry: { maximumAttempts: options.attempts },
	};
	if (!POLL_ACTIVITIES.has(name)) return base;
	return {
		...base,
		heartbeatTimeout: 60_000,
		cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
		retry: {
			...base.retry,
			initialInterval: "5 seconds",
			backoffCoefficient: 2,
			maximumInterval: "5 minutes",
		},
	};
}

export function createTemporalContext(): DurableContext {
	return {
		pollChunkMs: POLL_CHUNK_MS,
		async call<K extends ActivityName>(
			name: K,
			input: ActivityInput<K>,
			options: CallOptions,
		): Promise<ActivityOutput<K>> {
			const activities = proxyActivities<WorkflowRunActivities>(
				activityOptions(name, options),
			);
			try {
				const activity = activities[name] as (
					input: ActivityInput<typeof name>,
				) => Promise<ActivityOutput<typeof name>>;
				return await activity(input);
			} catch (error) {
				if (isCancellation(error)) throw error;
				throw toNodeError(error);
			}
		},
		sleep: (_key, ms) => sleep(ms),
		isCancellation,
	};
}

function toNodeError(error: unknown): unknown {
	if (!(error instanceof ActivityFailure)) return error;
	const cause = error.cause;
	return new NodeError({
		message: cause?.message ?? error.message,
		code:
			cause instanceof ApplicationFailure && cause.type
				? cause.type
				: "ActivityFailed",
		retryable: false,
		timedOut: hasTimeoutCause(error),
	});
}

function hasTimeoutCause(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
		if (current.name === "TimeoutFailure") return true;
		current = current.cause;
	}
	return false;
}

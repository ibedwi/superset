import type { WorkflowRunActivities } from "../../../activities/workflowActivities";
import type {
	ActivityInput,
	ActivityName,
	ActivityOutput,
	CallOptions,
	DurableContext,
} from "../../durableContext";

export class MemoryCancellation extends Error {
	constructor() {
		super("Run canceled");
		this.name = "MemoryCancellation";
	}
}

export interface RecordedCall {
	name: ActivityName;
	input: unknown;
	options: CallOptions;
}

export function createMemoryContext(args: {
	activities: WorkflowRunActivities;
	pollChunkMs?: number;
}): DurableContext & { calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	return {
		calls,
		pollChunkMs: args.pollChunkMs ?? 60_000,
		async call<K extends ActivityName>(
			name: K,
			input: ActivityInput<K>,
			options: CallOptions,
		): Promise<ActivityOutput<K>> {
			calls.push({ name, input, options });
			const activity = args.activities[name] as (
				input: ActivityInput<K>,
			) => Promise<ActivityOutput<K>>;
			return activity(input);
		},
		sleep: async () => {},
		isCancellation: (error) => error instanceof MemoryCancellation,
	};
}

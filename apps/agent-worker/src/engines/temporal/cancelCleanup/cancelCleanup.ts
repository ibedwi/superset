import { CancellationScope, log } from "@temporalio/workflow";
import type {
	ActivityInput,
	ActivityName,
	ActivityOutput,
	CallOptions,
	DurableContext,
} from "../../durableContext";

const CLEANUP = { timeoutMs: 30_000, attempts: 10 };

type Observers = {
	[K in ActivityName]?: (args: {
		input: ActivityInput<K>;
		result: ActivityOutput<K>;
	}) => void;
};

/**
 * Temporal runs no code after a cancel unless the workflow does it, so this
 * adapter keeps the cleanup the API will own from Milestone 2: kill CLI
 * jobs, mark started steps canceled, record the run canceled. Delete this
 * folder and the call in workflowRun.ts when that moves.
 */
export async function runWithCancelCleanup(args: {
	ctx: DurableContext;
	runId: string;
	run: (ctx: DurableContext) => Promise<void>;
}): Promise<void> {
	const { ctx, runId } = args;
	const cliJobs = new Map<string, { hostId: string; jobId: string }>();
	const startedSteps = new Map<string, string>();
	const finishedSteps = new Set<string>();

	const observers: Observers = {
		recordStep: ({ input }) => {
			if (input.status === "running") {
				startedSteps.set(input.nodeId, input.nodeType);
				return;
			}
			finishedSteps.add(input.nodeId);
			cliJobs.delete(input.nodeId);
		},
		execCliNode: ({ input, result }) => {
			cliJobs.set(input.nodeId, { hostId: input.hostId, jobId: result.jobId });
		},
	};

	const tracked: DurableContext = {
		...ctx,
		async call<K extends ActivityName>(
			name: K,
			input: ActivityInput<K>,
			options: CallOptions,
		): Promise<ActivityOutput<K>> {
			const result = await ctx.call(name, input, options);
			observers[name]?.({ input, result });
			return result;
		},
	};

	try {
		await args.run(tracked);
	} catch (error) {
		if (ctx.isCancellation(error)) {
			await CancellationScope.nonCancellable(async () => {
				for (const [nodeId, job] of cliJobs) {
					try {
						await ctx.call(
							"killCliNode",
							{ runId, ...job },
							{ key: `cleanup:kill:${nodeId}`, ...CLEANUP },
						);
					} catch (killError) {
						log.error("Could not kill CLI job", {
							nodeId,
							error:
								killError instanceof Error
									? killError.message
									: String(killError),
						});
					}
				}
				for (const [nodeId, nodeType] of startedSteps) {
					if (finishedSteps.has(nodeId)) continue;
					await ctx.call(
						"recordStep",
						{ runId, nodeId, nodeType, status: "canceled" },
						{ key: `cleanup:step:${nodeId}`, ...CLEANUP },
					);
				}
				await ctx.call(
					"recordRunStatus",
					{ runId, status: "canceled" },
					{ key: "cleanup:run", ...CLEANUP },
				);
			});
		}
		throw error;
	}
}

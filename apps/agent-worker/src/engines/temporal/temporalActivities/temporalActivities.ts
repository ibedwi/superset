import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
	createWorkflowActivities,
	type WorkflowActivityDeps,
	type WorkflowRunActivities,
} from "../../../activities/workflowActivities";
import { NodeError } from "../../nodeError";

export function createTemporalActivities(
	deps: Omit<WorkflowActivityDeps, "runtime">,
): WorkflowRunActivities {
	const activities = createWorkflowActivities({
		...deps,
		runtime: () => {
			const context = Context.current();
			return {
				heartbeat: () => context.heartbeat(),
				signal: context.cancellationSignal,
				sleep: (ms) => context.sleep(ms),
			};
		},
	});
	return {
		loadWorkflowRun: failingAsApplicationFailure(activities.loadWorkflowRun),
		recordRunStatus: failingAsApplicationFailure(activities.recordRunStatus),
		recordStep: failingAsApplicationFailure(activities.recordStep),
		dispatchAgentNode: failingAsApplicationFailure(
			activities.dispatchAgentNode,
		),
		awaitAgentNode: failingAsApplicationFailure(activities.awaitAgentNode),
		captureAgentOutput: failingAsApplicationFailure(
			activities.captureAgentOutput,
		),
		execCliNode: failingAsApplicationFailure(activities.execCliNode),
		pollCliNode: failingAsApplicationFailure(activities.pollCliNode),
		killCliNode: failingAsApplicationFailure(activities.killCliNode),
		callLlmNode: failingAsApplicationFailure(activities.callLlmNode),
		callHttpNode: failingAsApplicationFailure(activities.callHttpNode),
	};
}

function failingAsApplicationFailure<Input, Output>(
	activity: (input: Input) => Promise<Output>,
): (input: Input) => Promise<Output> {
	return async (input) => {
		try {
			return await activity(input);
		} catch (error) {
			if (!(error instanceof NodeError)) throw error;
			throw error.retryable
				? ApplicationFailure.retryable(error.message, error.code)
				: ApplicationFailure.nonRetryable(error.message, error.code);
		}
	};
}

import type { WorkflowRunActivities } from "../../../activities/workflowActivities";

const unexpected = async (): Promise<never> => {
	throw new Error("Unexpected activity call");
};

export function stubActivities(
	overrides: Partial<WorkflowRunActivities> = {},
): WorkflowRunActivities {
	return {
		loadWorkflowRun: unexpected,
		recordRunStatus: unexpected,
		recordStep: unexpected,
		dispatchAgentNode: unexpected,
		awaitAgentNode: unexpected,
		captureAgentOutput: unexpected,
		execCliNode: unexpected,
		pollCliNode: unexpected,
		killCliNode: unexpected,
		callLlmNode: unexpected,
		callHttpNode: unexpected,
		...overrides,
	};
}

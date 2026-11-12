import { AGENT_TASK_QUEUE } from "@superset/agent-harness/session/definitions";
import { agentTemporal } from "../../agent-runtime";
import type { WorkflowEngine } from "../types";

export function workflowRunWorkflowId(runId: string): string {
	return `workflow-run-${runId}`;
}

export const temporalWorkflowEngine: WorkflowEngine = {
	id: "temporal",

	async start({ runId }) {
		const { WorkflowIdConflictPolicy } = await import("@temporalio/client");
		const temporal = await agentTemporal();
		await temporal.workflow.start("workflowRun", {
			workflowId: workflowRunWorkflowId(runId),
			taskQueue: AGENT_TASK_QUEUE,
			args: [{ runId }],
			workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
		});
		return {};
	},

	async cancel({ runId }) {
		const temporal = await agentTemporal();
		await temporal.workflow.getHandle(workflowRunWorkflowId(runId)).cancel();
	},
};

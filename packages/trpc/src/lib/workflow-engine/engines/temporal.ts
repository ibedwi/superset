import { AGENT_TASK_QUEUE } from "@superset/agent-harness/session/definitions";
import { WORKFLOW_CONNECTION_TASK_QUEUE } from "@superset/shared/workflow-engine";
import { agentTemporal } from "../../agent-runtime";
import { assertConnectionHostAllowed } from "../hostGuard";
import type { WorkflowEngine, WorkflowEngineConnection } from "../types";
import { temporalClientFor } from "./temporalClients";

export function workflowRunWorkflowId(runId: string): string {
	return `workflow-run-${runId}`;
}

async function clientFor(connection: WorkflowEngineConnection | null) {
	if (!connection) return agentTemporal();
	if (connection.provider !== "temporal") {
		throw new Error(`Connection ${connection.id} is not a Temporal connection`);
	}
	await assertConnectionHostAllowed({ connection });
	return temporalClientFor(connection);
}

export const temporalWorkflowEngine: WorkflowEngine = {
	id: "temporal",

	async start({ runId, connection }) {
		const { WorkflowIdConflictPolicy } = await import("@temporalio/client");
		const temporal = await clientFor(connection);
		await temporal.workflow.start("workflowRun", {
			workflowId: workflowRunWorkflowId(runId),
			taskQueue: connection ? WORKFLOW_CONNECTION_TASK_QUEUE : AGENT_TASK_QUEUE,
			args: [{ runId }],
			workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
		});
		return {};
	},

	async cancel({ runId, connection }) {
		const temporal = await clientFor(connection);
		await temporal.workflow.getHandle(workflowRunWorkflowId(runId)).cancel();
	},
};

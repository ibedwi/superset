import {
	type TemporalEngineConnection,
	temporalConnectOptions,
	WORKFLOW_CONNECTION_TASK_QUEUE,
} from "@superset/shared/workflow-engine";
import { NativeConnection, Worker } from "@temporalio/worker";
import type { WorkflowRunActivities } from "../../../activities/workflowActivities";
import type { EngineHandle } from "../../engineHandle";
import {
	connectionWorkflowSource,
	type WorkflowSource,
} from "../workflowSource";

const MAX_POLLERS = 2;
const SHUTDOWN_GRACE = "30 seconds";

export interface WorkflowTemporalWorkerDeps {
	connection: TemporalEngineConnection;
	/** The workflow activities wrapped for Temporal; no Devs activities belong here. */
	activities: WorkflowRunActivities;
	workflowSource?: () => Promise<WorkflowSource>;
}

/**
 * Serves `workflowRun` on an organization's own Temporal namespace. It does
 * not run agentSession, the reconcile schedule or pdev: those belong to this
 * platform's Temporal.
 */
export async function startWorkflowTemporalWorker(
	deps: WorkflowTemporalWorkerDeps,
): Promise<EngineHandle> {
	const { connection } = deps;
	const native = await NativeConnection.connect(
		temporalConnectOptions(connection),
	);
	try {
		await native.workflowService.describeNamespace({
			namespace: connection.namespace,
		});
		const worker = await Worker.create({
			connection: native,
			namespace: connection.namespace,
			taskQueue: WORKFLOW_CONNECTION_TASK_QUEUE,
			defaultHeartbeatThrottleInterval: "2 seconds",
			maxHeartbeatThrottleInterval: "2 seconds",
			maxConcurrentWorkflowTaskPolls: MAX_POLLERS,
			maxConcurrentActivityTaskPolls: MAX_POLLERS,
			...(await (deps.workflowSource ?? connectionWorkflowSource)()),
			activities: { ...deps.activities },
			shutdownGraceTime: SHUTDOWN_GRACE,
		});
		const closed = worker.run().finally(() => native.close());
		return {
			closed,
			isRunning: () => worker.getState() === "RUNNING",
			async stop() {
				if (worker.getState() === "RUNNING") worker.shutdown();
				await closed;
			},
		};
	} catch (error) {
		await native.close();
		throw error;
	}
}

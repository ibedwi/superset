import type { WorkflowEngineConnection } from "@superset/shared/workflow-engine";

export type {
	InngestEngineConnection,
	TemporalEngineConnection,
	WorkflowEngineConnection,
} from "@superset/shared/workflow-engine";

export const WORKFLOW_ENGINE_IDS = [
	"temporal",
	"postgres",
	"inngest",
	"trigger",
] as const;

export type WorkflowEngineId = (typeof WORKFLOW_ENGINE_IDS)[number];

export interface WorkflowEngine {
	id: WorkflowEngineId;
	/** Must be safe to call twice for one run. `connection` is null for the deployment-wide account. */
	start(args: {
		runId: string;
		organizationId: string;
		connection: WorkflowEngineConnection | null;
	}): Promise<{ engineRunId?: string }>;
	/** Stops the engine's execution. Database cleanup is finalizeCanceledRun's job. */
	cancel(args: {
		runId: string;
		engineRunId: string | null;
		connection: WorkflowEngineConnection | null;
	}): Promise<void>;
}

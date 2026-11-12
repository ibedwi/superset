export const WORKFLOW_ENGINE_IDS = [
	"temporal",
	"postgres",
	"inngest",
	"trigger",
] as const;

export type WorkflowEngineId = (typeof WORKFLOW_ENGINE_IDS)[number];

export interface WorkflowEngine {
	id: WorkflowEngineId;
	/** Must be safe to call twice for one run. */
	start(args: {
		runId: string;
		organizationId: string;
	}): Promise<{ engineRunId?: string }>;
	/** Stops the engine's execution. Database cleanup is finalizeCanceledRun's job. */
	cancel(args: { runId: string; engineRunId: string | null }): Promise<void>;
}

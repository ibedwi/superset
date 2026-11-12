import { env } from "../../env";
import { inngestWorkflowEngine } from "./engines/inngest";
import { postgresWorkflowEngine } from "./engines/postgres";
import { temporalWorkflowEngine } from "./engines/temporal";
import { triggerWorkflowEngine } from "./engines/trigger";
import {
	WORKFLOW_ENGINE_IDS,
	type WorkflowEngine,
	type WorkflowEngineId,
} from "./types";

const REGISTERED_ENGINES: Record<WorkflowEngineId, WorkflowEngine> = {
	temporal: temporalWorkflowEngine,
	postgres: postgresWorkflowEngine,
	inngest: inngestWorkflowEngine,
	trigger: triggerWorkflowEngine,
};

export function defaultWorkflowEngineId(args: {
	configured: WorkflowEngineId | undefined;
	temporalAddress: string | undefined;
}): WorkflowEngineId {
	if (args.configured) return args.configured;
	return args.temporalAddress ? "temporal" : "postgres";
}

export function isWorkflowEngineId(value: string): value is WorkflowEngineId {
	return (WORKFLOW_ENGINE_IDS as readonly string[]).includes(value);
}

export function workflowEngineById(id: string): WorkflowEngine {
	const engine = isWorkflowEngineId(id) ? REGISTERED_ENGINES[id] : undefined;
	if (!engine) {
		throw new Error(`Workflow engine ${id} is not available in this build.`);
	}
	return engine;
}

/** organizationId is the seam for a per-organization override. */
export function resolveWorkflowEngine(_args: {
	organizationId: string;
}): WorkflowEngine {
	return workflowEngineById(
		defaultWorkflowEngineId({
			configured: env.WORKFLOW_ENGINE,
			temporalAddress: env.TEMPORAL_ADDRESS,
		}),
	);
}

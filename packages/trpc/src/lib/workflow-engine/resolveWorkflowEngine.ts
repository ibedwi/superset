import { rawErrorMessage } from "@superset/i18n/errors";
import { env } from "../../env";
import { connectionFromRow, findConnectionRow } from "./connections";
import { inngestWorkflowEngine } from "./engines/inngest";
import { postgresWorkflowEngine } from "./engines/postgres";
import { temporalWorkflowEngine } from "./engines/temporal";
import { triggerWorkflowEngine } from "./engines/trigger";
import {
	WORKFLOW_ENGINE_IDS,
	type WorkflowEngine,
	type WorkflowEngineConnection,
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

export interface ResolvedWorkflowEngine {
	engine: WorkflowEngine;
	/** The organization's own account, or null for the deployment-wide one. */
	connection: WorkflowEngineConnection | null;
}

async function loadOrganizationConnection(args: {
	organizationId: string;
}): Promise<WorkflowEngineConnection | null> {
	const row = await findConnectionRow(args);
	if (!row) return null;
	try {
		return connectionFromRow(row);
	} catch (error) {
		throw new Error(
			`The ${row.provider} connection of this organization cannot be read: ${rawErrorMessage(error)}`,
		);
	}
}

/**
 * An organization's connection wins over the deployment engine, and nothing
 * falls back to the deployment engine when that connection later fails.
 */
export async function resolveWorkflowEngine(args: {
	organizationId: string;
	loadConnection?: (args: {
		organizationId: string;
	}) => Promise<WorkflowEngineConnection | null>;
}): Promise<ResolvedWorkflowEngine> {
	const connection = await (args.loadConnection ?? loadOrganizationConnection)({
		organizationId: args.organizationId,
	});
	if (connection) {
		return { engine: workflowEngineById(connection.provider), connection };
	}
	return {
		engine: workflowEngineById(
			defaultWorkflowEngineId({
				configured: env.WORKFLOW_ENGINE,
				temporalAddress: env.TEMPORAL_ADDRESS,
			}),
		),
		connection: null,
	};
}

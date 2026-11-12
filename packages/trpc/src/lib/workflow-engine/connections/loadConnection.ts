import { db } from "@superset/db/client";
import { workflowEngineConnections } from "@superset/db/schema";
import type { WorkflowEngineConnection } from "@superset/shared/workflow-engine";
import { eq, sql } from "drizzle-orm";
import { joinConnection } from "./schemas";
import { openCredentials } from "./sealedCredentials";

export const connectionColumns = {
	id: workflowEngineConnections.id,
	organizationId: workflowEngineConnections.organizationId,
	provider: workflowEngineConnections.provider,
	config: workflowEngineConnections.config,
	encryptedCredentials: workflowEngineConnections.encryptedCredentials,
	status: workflowEngineConnections.status,
	lastError: workflowEngineConnections.lastError,
	lastCheckedAt: workflowEngineConnections.lastCheckedAt,
	createdAt: workflowEngineConnections.createdAt,
	updatedAt: workflowEngineConnections.updatedAt,
	version: sql<string>`${workflowEngineConnections.updatedAt}::text`,
};

export type ConnectionRow = {
	id: string;
	organizationId: string;
	provider: string;
	config: unknown;
	encryptedCredentials: string;
	status: string;
	lastError: string | null;
	lastCheckedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	version: string;
};

/** Decrypts the credentials; throws when the key is missing or the row was tampered with. */
export function connectionFromRow(
	row: ConnectionRow,
): WorkflowEngineConnection {
	return joinConnection({
		id: row.id,
		updatedAt: row.version,
		provider: row.provider,
		config: row.config,
		credentials: openCredentials({
			organizationId: row.organizationId,
			sealed: row.encryptedCredentials,
		}),
	});
}

export async function findConnectionRow(args: {
	organizationId: string;
}): Promise<ConnectionRow | undefined> {
	const [row] = await db
		.select(connectionColumns)
		.from(workflowEngineConnections)
		.where(eq(workflowEngineConnections.organizationId, args.organizationId))
		.limit(1);
	return row;
}

export async function findConnectionRowById(args: {
	id: string;
}): Promise<ConnectionRow | undefined> {
	const [row] = await db
		.select(connectionColumns)
		.from(workflowEngineConnections)
		.where(eq(workflowEngineConnections.id, args.id))
		.limit(1);
	return row;
}

export function listConnectionRows(): Promise<ConnectionRow[]> {
	return db.select(connectionColumns).from(workflowEngineConnections);
}

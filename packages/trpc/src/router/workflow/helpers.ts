import { db } from "@superset/db/client";
import { workflows } from "@superset/db/schema";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

export const workflowColumns = {
	id: workflows.id,
	organizationId: workflows.organizationId,
	ownerUserId: workflows.ownerUserId,
	name: workflows.name,
	description: workflows.description,
	headVersion: workflows.headVersion,
	liveVersionId: workflows.liveVersionId,
	enabled: workflows.enabled,
	archivedAt: workflows.archivedAt,
	createdAt: workflows.createdAt,
	updatedAt: workflows.updatedAt,
};

export function workflowNotFound() {
	return new TRPCError({ code: "NOT_FOUND", message: "Workflow not found" });
}

/** Reads are org-scoped; mutations go through getWorkflowForUser. */
export async function getWorkflowInOrg(organizationId: string, id: string) {
	const [row] = await db
		.select(workflowColumns)
		.from(workflows)
		.where(and(eq(workflows.id, id), eq(workflows.organizationId, organizationId)))
		.limit(1);
	if (!row) throw workflowNotFound();
	return row;
}

export async function getWorkflowForUser(
	userId: string,
	organizationId: string,
	id: string,
) {
	const row = await getWorkflowInOrg(organizationId, id);
	if (row.ownerUserId !== userId) throw workflowNotFound();
	return row;
}

export function assertWorkflowNotArchived(workflow: {
	archivedAt: Date | null;
}) {
	if (workflow.archivedAt === null) return;
	throw new TRPCError({
		code: "PRECONDITION_FAILED",
		message: "This workflow is archived. Restore it first.",
	});
}

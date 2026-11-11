import { createHash } from "node:crypto";
import { db, dbWs } from "@superset/db/client";
import { users, workflows, workflowVersions } from "@superset/db/schema";
import {
	type WorkflowGraph,
	validateGraph,
	workflowGraphSchema,
} from "@superset/shared/workflow-graph";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { personProcedure } from "../../trpc";
import { requireActiveOrgMembership } from "../utils/active-org";
import { getWorkflowForUser, workflowNotFound } from "./helpers";

export function graphContentHash(graph: WorkflowGraph): string {
	return createHash("sha256").update(JSON.stringify(graph)).digest("hex");
}

/**
 * Strict parse plus structural validation, as one gate: what the editor can
 * hold as a draft is wider than what may be saved as a runnable version.
 */
export function parseGraphForSave(graph: unknown): WorkflowGraph {
	const parsed = workflowGraphSchema.safeParse(graph);
	if (!parsed.success) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Graph is not valid",
			cause: parsed.error.issues,
		});
	}
	const problems = validateGraph(parsed.data);
	if (problems.length > 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `Graph is not valid: ${problems.map((p) => p.kind).join(", ")}`,
			cause: problems,
		});
	}
	return parsed.data;
}

/**
 * The one write path for versions: bump headVersion under optimistic
 * concurrency, insert the immutable version row, repoint liveVersionId.
 */
async function writeVersion(params: {
	workflowId: string;
	organizationId: string;
	authorUserId: string;
	expectedVersion: number;
	graph: WorkflowGraph;
}) {
	return dbWs.transaction(async (tx) => {
		const [bumped] = await tx
			.update(workflows)
			.set({ headVersion: sql`${workflows.headVersion} + 1` })
			.where(
				and(
					eq(workflows.id, params.workflowId),
					eq(workflows.organizationId, params.organizationId),
					eq(workflows.headVersion, params.expectedVersion),
				),
			)
			.returning({ headVersion: workflows.headVersion });
		if (!bumped) {
			// The caller saw an older headVersion than the row holds now.
			throw new TRPCError({
				code: "CONFLICT",
				message: "The workflow was edited elsewhere. Reload the latest version.",
			});
		}
		const [version] = await tx
			.insert(workflowVersions)
			.values({
				workflowId: params.workflowId,
				authorUserId: params.authorUserId,
				version: bumped.headVersion,
				graph: params.graph,
				contentHash: graphContentHash(params.graph),
			})
			.returning({ id: workflowVersions.id, version: workflowVersions.version });
		if (!version) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: "Failed to record workflow version",
			});
		}
		await tx
			.update(workflows)
			.set({ liveVersionId: version.id })
			.where(eq(workflows.id, params.workflowId));
		return { versionId: version.id, version: version.version };
	});
}

export const workflowGraphProcedures = {
	saveGraph: personProcedure
		.input(
			z.object({
				workflowId: z.string().uuid(),
				graph: z.unknown(),
				expectedVersion: z.number().int().min(0),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.workflowId);
			const graph = parseGraphForSave(input.graph);
			const saved = await writeVersion({
				workflowId: input.workflowId,
				organizationId,
				authorUserId: ctx.session.user.id,
				expectedVersion: input.expectedVersion,
				graph,
			});
			return { ...saved, headVersion: saved.version };
		}),

	listVersions: personProcedure
		.input(
			z.object({
				workflowId: z.string().uuid(),
				limit: z.number().int().min(1).max(200).default(50),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.workflowId);
			return db
				.select({
					id: workflowVersions.id,
					version: workflowVersions.version,
					authorUserId: workflowVersions.authorUserId,
					authorName: users.name,
					contentHash: workflowVersions.contentHash,
					createdAt: workflowVersions.createdAt,
				})
				.from(workflowVersions)
				.leftJoin(users, eq(users.id, workflowVersions.authorUserId))
				.where(eq(workflowVersions.workflowId, input.workflowId))
				.orderBy(desc(workflowVersions.version))
				.limit(input.limit);
		}),

	getVersion: personProcedure
		.input(
			z.object({ workflowId: z.string().uuid(), versionId: z.string().uuid() }),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.workflowId);
			const [row] = await db
				.select()
				.from(workflowVersions)
				.where(
					and(
						eq(workflowVersions.id, input.versionId),
						eq(workflowVersions.workflowId, input.workflowId),
					),
				)
				.limit(1);
			if (!row) throw workflowNotFound();
			return row;
		}),

	/** Restoring writes a NEW head version holding the old graph. */
	restoreVersion: personProcedure
		.input(
			z.object({
				workflowId: z.string().uuid(),
				versionId: z.string().uuid(),
				expectedVersion: z.number().int().min(0),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.workflowId);
			const [row] = await db
				.select({ graph: workflowVersions.graph })
				.from(workflowVersions)
				.where(
					and(
						eq(workflowVersions.id, input.versionId),
						eq(workflowVersions.workflowId, input.workflowId),
					),
				)
				.limit(1);
			if (!row) throw workflowNotFound();
			const saved = await writeVersion({
				workflowId: input.workflowId,
				organizationId,
				authorUserId: ctx.session.user.id,
				expectedVersion: input.expectedVersion,
				graph: row.graph,
			});
			return { ...saved, headVersion: saved.version };
		}),
} satisfies TRPCRouterRecord;

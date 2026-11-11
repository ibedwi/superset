import { db } from "@superset/db/client";
import {
	workflows,
	workflowTriggers,
	workflowVersions,
} from "@superset/db/schema";
import { escapeLikePattern } from "@superset/db/utils";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, asc, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { personProcedure } from "../../trpc";
import { requireActiveOrgMembership } from "../utils/active-org";
import { workflowGraphProcedures } from "./graph";
import {
	getWorkflowForUser,
	getWorkflowInOrg,
	workflowColumns,
} from "./helpers";
import { workflowRunProcedures } from "./run";
import { workflowTriggerProcedures } from "./trigger";

const workflowCrud = {
	list: personProcedure
		.input(
			z
				.object({
					name: z.string().trim().min(1).optional(),
					archived: z.boolean().optional(),
				})
				.optional(),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			return db
				.select(workflowColumns)
				.from(workflows)
				.where(
					and(
						eq(workflows.organizationId, organizationId),
						input?.archived
							? isNotNull(workflows.archivedAt)
							: isNull(workflows.archivedAt),
						input?.name
							? ilike(workflows.name, `%${escapeLikePattern(input.name)}%`)
							: undefined,
					),
				)
				.orderBy(desc(workflows.createdAt));
		}),

	/** Metadata plus the live graph and the trigger set — what the editor opens. */
	get: personProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const workflow = await getWorkflowInOrg(organizationId, input.id);

			const [version] = workflow.liveVersionId
				? await db
						.select({
							id: workflowVersions.id,
							version: workflowVersions.version,
							graph: workflowVersions.graph,
						})
						.from(workflowVersions)
						.where(eq(workflowVersions.id, workflow.liveVersionId))
						.limit(1)
				: [];

			const triggers = await db
				.select({
					id: workflowTriggers.id,
					kind: workflowTriggers.kind,
					config: workflowTriggers.config,
					connectionId: workflowTriggers.connectionId,
					nextRunAt: workflowTriggers.nextRunAt,
					secretPrefix: workflowTriggers.secretPrefix,
					secretRotatedAt: workflowTriggers.secretRotatedAt,
				})
				.from(workflowTriggers)
				.where(eq(workflowTriggers.workflowId, input.id))
				.orderBy(asc(workflowTriggers.createdAt));

			return { ...workflow, liveGraph: version ?? null, triggers };
		}),

	create: personProcedure
		.input(
			z.object({
				name: z.string().min(1).max(200),
				description: z.string().max(2000).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const [row] = await db
				.insert(workflows)
				.values({
					organizationId,
					ownerUserId: ctx.session.user.id,
					name: input.name,
					description: input.description ?? null,
				})
				.returning(workflowColumns);
			if (!row) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create workflow",
				});
			}
			return row;
		}),

	update: personProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				name: z.string().min(1).max(200).optional(),
				description: z.string().max(2000).nullish(),
				enabled: z.boolean().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.id);
			const [row] = await db
				.update(workflows)
				.set({
					...(input.name !== undefined ? { name: input.name } : {}),
					...(input.description !== undefined
						? { description: input.description }
						: {}),
					...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
				})
				.where(eq(workflows.id, input.id))
				.returning(workflowColumns);
			return row;
		}),

	/** Archive: it stops firing and leaves the list. `unarchive` restores it, paused. */
	archive: personProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.id);
			await db
				.update(workflows)
				.set({ archivedAt: new Date(), enabled: false })
				.where(and(eq(workflows.id, input.id), isNull(workflows.archivedAt)));
			return { archived: true };
		}),

	unarchive: personProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.id);
			await db
				.update(workflows)
				.set({ archivedAt: null })
				.where(eq(workflows.id, input.id));
			return { archived: false };
		}),

	deleteArchived: personProcedure
		.input(z.object({ id: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(ctx.session.user.id, organizationId, input.id);
			const deleted = await db
				.delete(workflows)
				.where(
					and(eq(workflows.id, input.id), isNotNull(workflows.archivedAt)),
				)
				.returning({ id: workflows.id });
			if (deleted.length === 0) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Archive the workflow before deleting it.",
				});
			}
			return { deleted: true };
		}),
} satisfies TRPCRouterRecord;

export const workflowRouter = {
	...workflowCrud,
	...workflowGraphProcedures,
	...workflowRunProcedures,
	...workflowTriggerProcedures,
} satisfies TRPCRouterRecord;

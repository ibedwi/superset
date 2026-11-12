import { db } from "@superset/db/client";
import {
	workflowRunSteps,
	workflowRuns,
	workflows,
	workflowTriggers,
} from "@superset/db/schema";
import { rawErrorMessage } from "@superset/i18n/errors";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { nudge } from "../../lib/realtime";
import { workflowEngineById } from "../../lib/workflow-engine";
import { personProcedure } from "../../trpc";
import { requireActiveOrgMembership } from "../utils/active-org";
import { dispatchWorkflow } from "./dispatch";
import { finalizeCanceledRun } from "./finalizeCanceledRun";
import {
	assertWorkflowNotArchived,
	getWorkflowForUser,
	getWorkflowInOrg,
	workflowNotFound,
} from "./helpers";

const cursorSchema = z.object({
	// Text form of createdAt: a JS Date truncates Postgres microseconds and
	// the keyset comparison then skips rows sharing the millisecond.
	createdAt: z.string().min(1),
	id: z.string().uuid(),
});

/** Keyset page over rows already fetched with limit+1. */
export function pageRuns<T extends { id: string; cursorAt: string }>(
	rows: T[],
	limit: number,
): { page: T[]; nextCursor: { createdAt: string; id: string } | null } {
	const hasMore = rows.length > limit;
	const page = hasMore ? rows.slice(0, limit) : rows;
	const last = page.at(-1);
	return {
		page,
		nextCursor:
			hasMore && last ? { createdAt: last.cursorAt, id: last.id } : null,
	};
}

function selectRuns(args: {
	organizationId: string;
	workflowId?: string;
	cursor?: { createdAt: string; id: string };
	limit: number;
}) {
	return db
		.select({
			id: workflowRuns.id,
			workflowId: workflowRuns.workflowId,
			workflowName: workflows.name,
			title: workflowRuns.title,
			status: workflowRuns.status,
			error: workflowRuns.error,
			triggerKind: workflowTriggers.kind,
			scheduledFor: workflowRuns.scheduledFor,
			startedAt: workflowRuns.startedAt,
			finishedAt: workflowRuns.finishedAt,
			createdAt: workflowRuns.createdAt,
			cursorAt: sql<string>`${workflowRuns.createdAt}::text`,
		})
		.from(workflowRuns)
		.innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
		.leftJoin(workflowTriggers, eq(workflowTriggers.id, workflowRuns.triggerId))
		.where(
			and(
				eq(workflowRuns.organizationId, args.organizationId),
				args.workflowId
					? eq(workflowRuns.workflowId, args.workflowId)
					: undefined,
				args.cursor
					? or(
							lt(sql`${workflowRuns.createdAt}::text`, args.cursor.createdAt),
							and(
								eq(sql`${workflowRuns.createdAt}::text`, args.cursor.createdAt),
								lt(workflowRuns.id, args.cursor.id),
							),
						)
					: undefined,
			),
		)
		.orderBy(desc(workflowRuns.createdAt), desc(workflowRuns.id))
		.limit(args.limit);
}

export const workflowRunProcedures = {
	runNow: personProcedure
		.input(z.object({ workflowId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const workflow = await getWorkflowForUser(
				ctx.session.user.id,
				organizationId,
				input.workflowId,
			);
			assertWorkflowNotArchived(workflow);
			if (!workflow.liveVersionId) {
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Save a graph before running the workflow.",
				});
			}
			const outcome = await dispatchWorkflow({ workflow });
			if (outcome.status === "conflict") {
				throw new TRPCError({
					code: "CONFLICT",
					message: "A run for this workflow is already in progress.",
				});
			}
			if (outcome.status === "rejected") {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: outcome.error,
				});
			}
			return { workflowId: workflow.id, runId: outcome.runId };
		}),

	listRuns: personProcedure
		.input(
			z.object({
				workflowId: z.string().uuid(),
				limit: z.number().int().min(1).max(100).default(50),
				cursor: cursorSchema.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowInOrg(organizationId, input.workflowId);
			const rows = await selectRuns({
				organizationId,
				workflowId: input.workflowId,
				cursor: input.cursor,
				limit: input.limit + 1,
			});
			const { page, nextCursor } = pageRuns(rows, input.limit);
			return {
				items: page.map(({ cursorAt: _cursorAt, ...run }) => run),
				nextCursor,
			};
		}),

	listOrgRuns: personProcedure
		.input(
			z.object({
				limit: z.number().int().min(1).max(100).default(50),
				cursor: cursorSchema.optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const rows = await selectRuns({
				organizationId,
				cursor: input.cursor,
				limit: input.limit + 1,
			});
			const { page, nextCursor } = pageRuns(rows, input.limit);
			return {
				items: page.map(({ cursorAt: _cursorAt, ...run }) => run),
				nextCursor,
			};
		}),

	getRun: personProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const [run] = await db
				.select()
				.from(workflowRuns)
				.where(
					and(
						eq(workflowRuns.id, input.runId),
						eq(workflowRuns.organizationId, organizationId),
					),
				)
				.limit(1);
			if (!run) throw workflowNotFound();
			const steps = await db
				.select()
				.from(workflowRunSteps)
				.where(eq(workflowRunSteps.runId, run.id))
				.orderBy(asc(workflowRunSteps.startedAt), asc(workflowRunSteps.nodeId));
			return { ...run, steps };
		}),

	cancelRun: personProcedure
		.input(z.object({ runId: z.string().uuid() }))
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			const [run] = await db
				.select({
					id: workflowRuns.id,
					workflowId: workflowRuns.workflowId,
					engine: workflowRuns.engine,
					engineRunId: workflowRuns.engineRunId,
				})
				.from(workflowRuns)
				.where(
					and(
						eq(workflowRuns.id, input.runId),
						eq(workflowRuns.organizationId, organizationId),
					),
				)
				.limit(1);
			if (!run) throw workflowNotFound();
			await getWorkflowForUser(
				ctx.session.user.id,
				organizationId,
				run.workflowId,
			);

			try {
				await workflowEngineById(run.engine).cancel({
					runId: run.id,
					engineRunId: run.engineRunId,
				});
			} catch (error) {
				console.warn(
					"[workflow/cancelRun] engine cancel failed",
					run.id,
					rawErrorMessage(error),
				);
			}
			await finalizeCanceledRun({ runId: run.id });
			nudge(organizationId, "workflow_runs");
			return { canceled: true };
		}),
} satisfies TRPCRouterRecord;

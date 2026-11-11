import { db } from "@superset/db/client";
import { type TriggerConfig, workflowTriggers } from "@superset/db/schema";
import {
	type DraftTrigger,
	describeTriggerProblems,
	draftTriggerSchema,
	summarizeTriggerProblems,
} from "@superset/shared/automation-triggers";
import { LAUNCHED_TRIGGER_KINDS } from "@superset/shared/constants";
import { nextOccurrenceAfter } from "@superset/shared/rrule";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { personProcedure } from "../../trpc";
import { requireActiveOrgMembership } from "../utils/active-org";
import {
	generateWebhookToken,
	hashWebhookToken,
} from "../automation/webhookSecret";
import { getWorkflowForUser, getWorkflowInOrg } from "./helpers";

/** Same contract as automation triggerSet: validation errors carry the form's wording. */
export function assertTriggerSaveable(trigger: DraftTrigger) {
	const launched: ReadonlySet<string> = new Set(LAUNCHED_TRIGGER_KINDS);
	if (!launched.has(trigger.config.kind)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `${trigger.config.kind} triggers are not available`,
		});
	}
	const problems = describeTriggerProblems([trigger]);
	if (problems.length > 0) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message:
				summarizeTriggerProblems(problems) ?? "Trigger is not configured",
			cause: problems,
		});
	}
}

export function nextRunAtFor(
	config: DraftTrigger["config"],
	after = new Date(),
): Date | null {
	if (config.kind !== "schedule") return null;
	return nextOccurrenceAfter({
		rrule: config.rrule,
		dtstart: new Date(config.dtstart),
		timezone: config.timezone,
		after,
	});
}

function recurrenceChanged(
	next: DraftTrigger["config"],
	previous: TriggerConfig,
): boolean {
	if (next.kind !== "schedule") return false;
	if (previous.kind !== "schedule") return true;
	return (
		previous.rrule !== next.rrule ||
		previous.dtstart !== next.dtstart ||
		previous.timezone !== next.timezone
	);
}

const triggerColumns = {
	id: workflowTriggers.id,
	workflowId: workflowTriggers.workflowId,
	kind: workflowTriggers.kind,
	config: workflowTriggers.config,
	connectionId: workflowTriggers.connectionId,
	nextRunAt: workflowTriggers.nextRunAt,
	secretPrefix: workflowTriggers.secretPrefix,
	secretRotatedAt: workflowTriggers.secretRotatedAt,
	createdAt: workflowTriggers.createdAt,
};

export const workflowTriggerProcedures = {
	listTriggers: personProcedure
		.input(z.object({ workflowId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowInOrg(organizationId, input.workflowId);
			return db
				.select(triggerColumns)
				.from(workflowTriggers)
				.where(eq(workflowTriggers.workflowId, input.workflowId))
				.orderBy(asc(workflowTriggers.createdAt));
		}),

	saveTrigger: personProcedure
		.input(
			z.object({
				workflowId: z.string().uuid(),
				trigger: draftTriggerSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(
				ctx.session.user.id,
				organizationId,
				input.workflowId,
			);
			assertTriggerSaveable(input.trigger);
			const config = input.trigger.config as TriggerConfig;

			if (input.trigger.id) {
				const [previous] = await db
					.select({
						id: workflowTriggers.id,
						config: workflowTriggers.config,
						nextRunAt: workflowTriggers.nextRunAt,
					})
					.from(workflowTriggers)
					.where(
						and(
							eq(workflowTriggers.id, input.trigger.id),
							eq(workflowTriggers.workflowId, input.workflowId),
						),
					)
					.limit(1);
				if (!previous) {
					throw new TRPCError({ code: "NOT_FOUND", message: "Trigger not found" });
				}
				// Only recompute when the recurrence moved, so a config touch does
				// not reschedule the workflow.
				const nextRunAt = recurrenceChanged(input.trigger.config, previous.config)
					? nextRunAtFor(input.trigger.config)
					: previous.nextRunAt;
				const [row] = await db
					.update(workflowTriggers)
					.set({
						kind: config.kind,
						config,
						nextRunAt,
						...(input.trigger.connectionId === undefined
							? {}
							: { connectionId: input.trigger.connectionId }),
					})
					.where(eq(workflowTriggers.id, previous.id))
					.returning(triggerColumns);
				return row;
			}

			const [row] = await db
				.insert(workflowTriggers)
				.values({
					workflowId: input.workflowId,
					organizationId,
					kind: config.kind,
					config,
					connectionId: input.trigger.connectionId ?? null,
					nextRunAt: nextRunAtFor(input.trigger.config),
				})
				.returning(triggerColumns);
			return row;
		}),

	deleteTrigger: personProcedure
		.input(
			z.object({ workflowId: z.string().uuid(), triggerId: z.string().uuid() }),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(
				ctx.session.user.id,
				organizationId,
				input.workflowId,
			);
			await db
				.delete(workflowTriggers)
				.where(
					and(
						eq(workflowTriggers.id, input.triggerId),
						eq(workflowTriggers.workflowId, input.workflowId),
					),
				);
			return { deleted: true };
		}),

	/** New bearer token for a webhook trigger; returned once, only its hash stored. */
	rotateWebhookSecret: personProcedure
		.input(
			z.object({ workflowId: z.string().uuid(), triggerId: z.string().uuid() }),
		)
		.mutation(async ({ ctx, input }) => {
			const organizationId = await requireActiveOrgMembership(ctx);
			await getWorkflowForUser(
				ctx.session.user.id,
				organizationId,
				input.workflowId,
			);
			const [trigger] = await db
				.select({ id: workflowTriggers.id, kind: workflowTriggers.kind })
				.from(workflowTriggers)
				.where(
					and(
						eq(workflowTriggers.id, input.triggerId),
						eq(workflowTriggers.workflowId, input.workflowId),
					),
				)
				.limit(1);
			if (!trigger || trigger.kind !== "webhook") {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Webhook trigger not found",
				});
			}
			const { token, prefix } = generateWebhookToken();
			const rotatedAt = new Date();
			await db
				.update(workflowTriggers)
				.set({
					secretHash: hashWebhookToken(token),
					secretPrefix: prefix,
					secretRotatedAt: rotatedAt,
				})
				.where(eq(workflowTriggers.id, trigger.id));
			return { triggerId: trigger.id, token, prefix, rotatedAt };
		}),
} satisfies TRPCRouterRecord;

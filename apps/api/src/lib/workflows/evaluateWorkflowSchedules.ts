import { db } from "@superset/db/client";
import {
	type TriggerConfig,
	workflows,
	workflowTriggers,
} from "@superset/db/schema";
import { nextOccurrenceAfter } from "@superset/shared/rrule";
import { Client } from "@upstash/qstash";
import { and, eq, isNull, lte } from "drizzle-orm";
import { env } from "@/env";

const qstash = new Client({
	token: env.QSTASH_TOKEN,
	baseUrl: env.QSTASH_URL,
});
const BATCH_SIZE = 2000;

function bucketToMinute(d: Date): Date {
	const copy = new Date(d.getTime());
	copy.setUTCSeconds(0, 0);
	return copy;
}

/** Null when the config can't drive a schedule, so the row surfaces as unusable. */
export function scheduleFromConfig(
	config: TriggerConfig | null,
): { rrule: string; dtstart: Date; timezone: string } | null {
	if (config === null || typeof config !== "object") return null;
	if (config.kind !== "schedule") return null;
	if (!config.rrule || !config.timezone) return null;
	const dtstart = new Date(config.dtstart);
	if (Number.isNaN(dtstart.getTime())) return null;
	return { rrule: config.rrule, dtstart, timezone: config.timezone };
}

export type DueWorkflowTrigger = {
	workflowId: string;
	triggerId: string;
	nextRunAt: Date;
	config: TriggerConfig | null;
};

export type PlannedWorkflowDispatch = {
	workflowId: string;
	triggerId: string;
	scheduledFor: Date;
	next: Date | null;
};

/**
 * Work out each due trigger's dispatch and its advanced next occurrence before
 * enqueuing anything: a trigger that cannot advance must not be enqueued, or
 * it would fire on every tick while its next_run_at stayed put.
 */
export function planWorkflowSchedules(rows: DueWorkflowTrigger[]): {
	planned: PlannedWorkflowDispatch[];
	unusable: Array<{ workflowId: string; reason: string }>;
} {
	const planned: PlannedWorkflowDispatch[] = [];
	const unusable: Array<{ workflowId: string; reason: string }> = [];
	for (const row of rows) {
		const schedule = scheduleFromConfig(row.config);
		if (!schedule) {
			unusable.push({
				workflowId: row.workflowId,
				reason: "schedule trigger config is unusable",
			});
			continue;
		}
		try {
			planned.push({
				workflowId: row.workflowId,
				triggerId: row.triggerId,
				scheduledFor: bucketToMinute(row.nextRunAt),
				next: nextOccurrenceAfter({ ...schedule, after: row.nextRunAt }),
			});
		} catch (error) {
			unusable.push({ workflowId: row.workflowId, reason: String(error) });
		}
	}
	return { planned, unusable };
}

/** The workflow half of the evaluate tick. TODO(workflows): plan-tier gating. */
export async function evaluateWorkflowSchedules(
	now: Date,
): Promise<{ enqueued: number; unusable: number }> {
	const rows = await db
		.select({
			workflowId: workflows.id,
			triggerId: workflowTriggers.id,
			nextRunAt: workflowTriggers.nextRunAt,
			config: workflowTriggers.config,
		})
		.from(workflowTriggers)
		.innerJoin(workflows, eq(workflows.id, workflowTriggers.workflowId))
		.where(
			and(
				eq(workflowTriggers.kind, "schedule"),
				eq(workflows.enabled, true),
				isNull(workflows.archivedAt),
				lte(workflowTriggers.nextRunAt, now),
			),
		)
		.orderBy(workflowTriggers.nextRunAt)
		.limit(BATCH_SIZE);

	const due = rows.filter(
		(row): row is (typeof rows)[number] & { nextRunAt: Date } =>
			row.nextRunAt !== null,
	);
	const { planned, unusable } = planWorkflowSchedules(due);
	if (unusable.length > 0) {
		console.error(
			"[workflows/evaluate] unusable schedule triggers, not dispatched",
			unusable,
		);
	}
	if (planned.length === 0) {
		return { enqueued: 0, unusable: unusable.length };
	}

	await qstash.batchJSON(
		planned.map(({ workflowId, triggerId, scheduledFor }) => ({
			url: `${env.NEXT_PUBLIC_API_URL}/api/workflows/dispatch/${workflowId}`,
			body: {
				workflowId,
				triggerId,
				scheduledFor: scheduledFor.toISOString(),
			},
			deduplicationId: `${workflowId}_${scheduledFor.getTime()}`,
			retries: 2,
		})),
	);

	const advanceResults = await Promise.allSettled(
		planned.map(({ triggerId, next }) =>
			db
				.update(workflowTriggers)
				.set({ nextRunAt: next })
				.where(eq(workflowTriggers.id, triggerId)),
		),
	);
	const advanceFailures = advanceResults.filter(
		(result) => result.status === "rejected",
	);
	if (advanceFailures.length > 0) {
		console.error("[workflows/evaluate] advanceNextRun failures", advanceFailures);
	}

	return { enqueued: planned.length, unusable: unusable.length };
}

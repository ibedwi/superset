import { AGENT_TASK_QUEUE } from "@superset/agent-harness/session/definitions";
import { db } from "@superset/db/client";
import { workflowRuns } from "@superset/db/schema";
import { WorkflowIdConflictPolicy } from "@temporalio/client";
import { eq, sql } from "drizzle-orm";
import { agentTemporal } from "../../lib/agent-runtime";
import { nudge } from "../../lib/realtime";

export function workflowRunWorkflowId(runId: string): string {
	return `workflow-run-${runId}`;
}

export type WorkflowDispatchCause =
	| { scheduledFor: Date; triggerId?: string; trigger?: null }
	| {
			scheduledFor?: null;
			triggerId?: null;
			trigger: { triggerId: string; eventId: string };
	  }
	| { scheduledFor?: null; triggerId?: null; trigger?: null };

export type WorkflowDispatchOutcome =
	| { status: "started"; runId: string }
	| { status: "conflict" }
	| { status: "rejected"; error: string };

/**
 * Start one workflow run: pin the live graph version, insert the run row
 * (the partial unique indexes absorb QStash replays), and start the Temporal
 * workflow. USE_EXISTING makes the Temporal start idempotent too, so a replay
 * that lost the insert race still converges on the same execution.
 */
export async function dispatchWorkflow(
	opts: {
		workflow: {
			id: string;
			organizationId: string;
			name: string;
			liveVersionId: string | null;
		};
		/** The matched event's payload, snapshotted before retention prunes it. */
		triggerContext?: unknown;
	} & WorkflowDispatchCause,
): Promise<WorkflowDispatchOutcome> {
	const { workflow } = opts;
	if (!workflow.liveVersionId) {
		return { status: "rejected", error: "workflow has no saved graph" };
	}
	const cause = runCause(opts);
	const [run] = await db
		.insert(workflowRuns)
		.values({
			workflowId: workflow.id,
			organizationId: workflow.organizationId,
			versionId: workflow.liveVersionId,
			title: workflow.name,
			...cause,
			triggerContext: opts.triggerContext ?? null,
			status: "pending",
		})
		.onConflictDoNothing(runDedupTarget(cause))
		.returning({ id: workflowRuns.id });
	if (!run) return { status: "conflict" };

	try {
		const temporal = await agentTemporal();
		await temporal.workflow.start("workflowRun", {
			workflowId: workflowRunWorkflowId(run.id),
			taskQueue: AGENT_TASK_QUEUE,
			args: [{ runId: run.id }],
			workflowIdConflictPolicy: WorkflowIdConflictPolicy.USE_EXISTING,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await db
			.update(workflowRuns)
			.set({ status: "failed", error: message, finishedAt: new Date() })
			.where(eq(workflowRuns.id, run.id));
		nudge(workflow.organizationId, "workflow_runs");
		return { status: "rejected", error: message };
	}

	nudge(workflow.organizationId, "workflow_runs");
	return { status: "started", runId: run.id };
}

type RunCause = {
	scheduledFor: Date | null;
	triggerId: string | null;
	eventId: string | null;
};

function runCause(opts: WorkflowDispatchCause): RunCause {
	if (opts.trigger) {
		return {
			scheduledFor: null,
			triggerId: opts.trigger.triggerId,
			eventId: opts.trigger.eventId,
		};
	}
	return {
		scheduledFor: opts.scheduledFor ?? null,
		triggerId: opts.triggerId ?? null,
		eventId: null,
	};
}

/** See runDedupTarget in ../automation/dispatch.ts: one target per index shape. */
function runDedupTarget(cause: RunCause) {
	return cause.eventId !== null
		? {
				target: [workflowRuns.triggerId, workflowRuns.eventId],
				where: sql`${workflowRuns.eventId} IS NOT NULL`,
			}
		: cause.scheduledFor !== null
			? {
					target: [workflowRuns.workflowId, workflowRuns.scheduledFor],
					where: sql`${workflowRuns.scheduledFor} IS NOT NULL`,
				}
			: // A manual run has nothing to collide on.
				undefined;
}

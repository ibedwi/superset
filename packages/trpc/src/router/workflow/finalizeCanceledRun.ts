import { dbWs } from "@superset/db/client";
import {
	workflowRunCheckpoints,
	workflowRunSteps,
	workflowRuns,
} from "@superset/db/schema";
import { rawErrorMessage } from "@superset/i18n/errors";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { killHostJob, runScope } from "./hostRelay";

const cliRefSchema = z.object({
	kind: z.literal("cli"),
	hostId: z.string(),
	jobId: z.string(),
});

type KillJob = (args: {
	runId: string;
	hostId: string;
	jobId: string;
}) => Promise<void>;

async function killJobThroughRelay(args: {
	runId: string;
	hostId: string;
	jobId: string;
}): Promise<void> {
	const scope = await runScope(args.runId);
	await killHostJob({ scope, hostId: args.hostId, jobId: args.jobId });
}

/** Safe to call twice: the second call finds nothing left to cancel. */
export async function finalizeCanceledRun(args: {
	runId: string;
	killJob?: KillJob;
}): Promise<{ killedJobs: number }> {
	const killJob = args.killJob ?? killJobThroughRelay;
	const jobs = await dbWs.transaction(async (tx) => {
		await tx
			.update(workflowRuns)
			.set({ status: "canceled", finishedAt: new Date() })
			.where(
				and(
					eq(workflowRuns.id, args.runId),
					inArray(workflowRuns.status, ["pending", "running"]),
				),
			);
		const active = await tx
			.update(workflowRunSteps)
			.set({ status: "canceled", finishedAt: new Date() })
			.where(
				and(
					eq(workflowRunSteps.runId, args.runId),
					inArray(workflowRunSteps.status, ["pending", "running"]),
				),
			)
			.returning({ externalRef: workflowRunSteps.externalRef });
		await tx
			.delete(workflowRunCheckpoints)
			.where(eq(workflowRunCheckpoints.runId, args.runId));
		return active.flatMap((step) => {
			const ref = cliRefSchema.safeParse(step.externalRef);
			return ref.success ? [ref.data] : [];
		});
	});
	const kills = await Promise.allSettled(
		jobs.map((job) =>
			killJob({ runId: args.runId, hostId: job.hostId, jobId: job.jobId }),
		),
	);
	for (const kill of kills) {
		if (kill.status === "rejected") {
			console.warn(
				"[workflow] could not kill CLI job of canceled run",
				args.runId,
				rawErrorMessage(kill.reason),
			);
		}
	}
	return { killedJobs: jobs.length };
}

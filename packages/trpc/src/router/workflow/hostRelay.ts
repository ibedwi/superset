import { mintUserJwt } from "@superset/auth/server";
import { db } from "@superset/db/client";
import { workflowRuns, workflows } from "@superset/db/schema";
import { rawErrorMessage } from "@superset/i18n/errors";
import { buildHostRoutingKey } from "@superset/shared/host-routing";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { env } from "../../env";
import {
	type RelayClientOptions,
	relayMutation,
	relayQuery,
} from "../automation/relay-client";

export const runNotFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Workflow run not found." });

export async function runScope(runId: string) {
	const [row] = await db
		.select({
			runId: workflowRuns.id,
			workflowId: workflowRuns.workflowId,
			organizationId: workflowRuns.organizationId,
			status: workflowRuns.status,
			ownerUserId: workflows.ownerUserId,
		})
		.from(workflowRuns)
		.innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
		.where(eq(workflowRuns.id, runId))
		.limit(1);
	if (!row) throw runNotFound();
	return row;
}

export async function hostRelay(
	scope: { runId: string; organizationId: string; ownerUserId: string },
	hostId: string,
	timeoutMs?: number,
): Promise<RelayClientOptions> {
	const jwt = await mintUserJwt({
		userId: scope.ownerUserId,
		organizationIds: [scope.organizationId],
		scope: "workflow-run",
		runId: scope.runId,
		ttlSeconds: 300,
	});
	return {
		relayUrl: env.RELAY_URL,
		hostId: buildHostRoutingKey(scope.organizationId, hostId),
		jwt,
		...(timeoutMs ? { timeoutMs } : {}),
	};
}

export function hostCaller(options: RelayClientOptions) {
	return {
		mutation: <TOutput>(procedure: string, input: object) =>
			relayMutation<object, TOutput>(options, procedure, input),
		query: <TOutput>(procedure: string, input: object) =>
			relayQuery<object, TOutput>(options, procedure, input),
	};
}

export const jobSessionId = (runId: string) => `workflow-${runId}`;

export async function killHostJob(args: {
	scope: { runId: string; organizationId: string; ownerUserId: string };
	hostId: string;
	jobId: string;
}): Promise<void> {
	const host = hostCaller(await hostRelay(args.scope, args.hostId));
	await host
		.mutation("agentJobs.kill", {
			sessionId: jobSessionId(args.scope.runId),
			jobId: args.jobId,
		})
		.catch((error) => {
			console.warn(
				"[workflow/killHostJob] kill failed",
				args.jobId,
				rawErrorMessage(error),
			);
		});
}

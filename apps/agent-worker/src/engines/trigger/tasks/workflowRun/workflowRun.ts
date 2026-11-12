import { task } from "@trigger.dev/sdk";
import { createWorkflowActivities } from "../../../../activities/workflowActivities";
import { workflowApi } from "../../../../clients/workflowApi";
import { requireEnv } from "../../../../config/requireEnv";
import { abortableSleep } from "../../../abortableSleep";
import { createJournaledContext } from "../../../journal";
import { runGraph } from "../../../runGraph";

const POLL_CHUNK_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

export const workflowRunTask = task({
	id: "workflow-run",
	retry: { maxAttempts: MAX_ATTEMPTS },
	run: async (payload: { runId: string }, { signal }) => {
		const env = process.env;
		const api = workflowApi({
			apiUrl: requireEnv({ env, name: "AGENT_API_URL" }),
			workerSecret: requireEnv({ env, name: "AGENT_WORKER_SECRET" }),
		});
		const sleep = (ms: number) => abortableSleep({ ms, signal });
		const activities = createWorkflowActivities({
			api,
			runtime: () => ({ heartbeat: () => {}, signal, sleep }),
		});
		const ctx = await createJournaledContext({
			api,
			activities,
			runId: payload.runId,
			signal,
			sleep,
			pollChunkMs: POLL_CHUNK_MS,
		});
		await runGraph({ ctx, runId: payload.runId });
	},
});

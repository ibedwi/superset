import { Inngest } from "inngest";
import { ConnectionState, connect } from "inngest/connect";
import type {
	ActivityRuntime,
	WorkflowRunActivities,
} from "../../../activities/workflowActivities";
import type { EngineHandle } from "../../engineHandle";
import { runGraph } from "../../runGraph";
import { createInngestContext } from "../inngestContext";

const APP_ID = "paradev-workflows";
const FUNCTION_ID = "workflow-run";
const FUNCTION_RETRIES = 3;
export const RUN_REQUESTED_EVENT = "workflow/run.requested";
export const RUN_CANCELED_EVENT = "workflow/run.canceled";

export interface InngestClientSettings {
	appId?: string | undefined;
	signingKey?: string | undefined;
	baseUrl?: string | undefined;
	isDev?: boolean | undefined;
}

export interface InngestEngineDeps {
	client: InngestClientSettings;
	/** Builds the activities of one run; the runtime never aborts a step. */
	activities: (runtime: () => ActivityRuntime) => WorkflowRunActivities;
	instanceId?: string;
}

export async function startInngestEngine(
	deps: InngestEngineDeps,
): Promise<EngineHandle> {
	const { client: settings } = deps;
	const inngest = new Inngest({
		id: settings.appId ?? APP_ID,
		...(settings.signingKey ? { signingKey: settings.signingKey } : {}),
		...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
		...(settings.isDev !== undefined ? { isDev: settings.isDev } : {}),
	});

	const runtime: ActivityRuntime = {
		heartbeat: () => {},
		signal: new AbortController().signal,
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	};

	const workflowRun = inngest.createFunction(
		{
			id: FUNCTION_ID,
			retries: FUNCTION_RETRIES,
			triggers: [{ event: RUN_REQUESTED_EVENT }],
			cancelOn: [{ event: RUN_CANCELED_EVENT, match: "data.runId" }],
		},
		async ({ event, step }) => {
			const runId = event.data.runId;
			if (typeof runId !== "string") {
				throw new Error(`${RUN_REQUESTED_EVENT} carries no runId`);
			}
			const ctx = createInngestContext({
				step,
				activities: deps.activities(() => runtime),
			});
			await runGraph({ ctx, runId });
		},
	);

	const connection = await connect({
		apps: [{ client: inngest, functions: [workflowRun] }],
		handleShutdownSignals: [],
		...(deps.instanceId ? { instanceId: deps.instanceId } : {}),
	});

	return {
		closed: connection.closed,
		isRunning: () =>
			connection.state !== ConnectionState.CLOSING &&
			connection.state !== ConnectionState.CLOSED,
		stop: () => connection.close(),
	};
}

import { Inngest } from "inngest";
import { ConnectionState, connect } from "inngest/connect";
import type {
	ActivityRuntime,
	WorkflowRunActivities,
} from "../../../activities/workflowActivities";
import { abortableSleep } from "../../abortableSleep";
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
	/** Builds the activities of one run; the runtime aborts when the engine stops. */
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

	const shutdown = new AbortController();
	const runtime: ActivityRuntime = {
		heartbeat: () => {},
		signal: shutdown.signal,
		sleep: (ms) => abortableSleep({ ms, signal: shutdown.signal }),
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
				shutdown: shutdown.signal,
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
		stop: () => stopAbortingFirst({ shutdown, connection }),
	};
}

/**
 * Draining waits for in-flight steps, and a poll chunk lasts up to 30
 * minutes, so the polls are aborted first. Inngest then retries them on
 * another worker.
 */
export function stopAbortingFirst(args: {
	shutdown: AbortController;
	connection: { close(): Promise<void> };
}): Promise<void> {
	args.shutdown.abort();
	return args.connection.close();
}

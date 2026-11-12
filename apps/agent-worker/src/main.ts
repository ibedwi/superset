import { createServer } from "node:http";
import { hostname } from "node:os";
import { createWorkflowActivities } from "./activities/workflowActivities";
import { workflowApi } from "./clients/workflowApi";
import { requireEnv } from "./config/requireEnv";
import { abortableSleep } from "./engines/abortableSleep";
import type { EngineHandle } from "./engines/engineHandle";
import { selectEngines } from "./engines/engineSelection";
import { startPostgresEngine } from "./engines/postgres/postgresEngine";
import { startTemporalWorker } from "./engines/temporal/startTemporalWorker";

const env = process.env;
const selection = selectEngines({ env });
const api = workflowApi({
	apiUrl: requireEnv({ env, name: "AGENT_API_URL" }),
	workerSecret: requireEnv({ env, name: "AGENT_WORKER_SECRET" }),
});

const engines: EngineHandle[] = [];
if (selection.startTemporal) {
	engines.push(await startTemporalWorker({ env, workflowApi: api }));
}
if (selection.startPostgres) {
	engines.push(
		await startPostgresEngine({
			api,
			workerId: `${hostname()}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`,
			sleep: abortableSleep,
			activities: (runtime) => createWorkflowActivities({ api, runtime }),
		}),
	);
}
if (selection.startInngest) {
	const { startInngestEngine } = await import(
		"./engines/inngest/inngestEngine"
	);
	const isDev = env.INNGEST_DEV === "1";
	engines.push(
		await startInngestEngine({
			client: {
				signingKey: isDev
					? env.INNGEST_SIGNING_KEY
					: requireEnv({ env, name: "INNGEST_SIGNING_KEY" }),
				baseUrl: env.INNGEST_BASE_URL,
				isDev: env.INNGEST_DEV ? isDev : undefined,
			},
			instanceId: `${hostname()}-${process.pid}`,
			activities: (runtime) => createWorkflowActivities({ api, runtime }),
		}),
	);
}

if (engines.length === 0) {
	throw new Error(
		`WORKFLOW_ENGINE=${selection.workflowEngine} needs no process in this worker, and TEMPORAL_ADDRESS is not set; nothing to start`,
	);
}

const stopAll = () => Promise.all(engines.map((engine) => engine.stop()));
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => void stopAll());
}
if (env.PORT) {
	createServer((_request, response) => {
		const up = engines.every((engine) => engine.isRunning());
		response.writeHead(up ? 200 : 503).end(up ? "RUNNING" : "NOT_RUNNING");
	}).listen(Number(env.PORT));
}
await Promise.all(engines.map((engine) => engine.closed));
process.exit(0);

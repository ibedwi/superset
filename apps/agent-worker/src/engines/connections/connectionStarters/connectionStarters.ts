import {
	assertConnectionHostAllowed,
	type ResolveHost,
} from "@superset/shared/ssrf";
import type {
	InngestEngineConnection,
	TemporalEngineConnection,
} from "@superset/shared/workflow-engine";
import type { EngineHandle } from "../../engineHandle";
import type { InngestEngineDeps } from "../../inngest/inngestEngine";
import type { WorkflowTemporalWorkerDeps } from "../../temporal/startWorkflowTemporalWorker";
import { withStartDeadline } from "../startDeadline";

const DEFAULT_START_DEADLINE_MS = 30_000;

export interface ConnectionStartersDeps {
	startInngestEngine: (deps: InngestEngineDeps) => Promise<EngineHandle>;
	startTemporalWorker: (
		deps: WorkflowTemporalWorkerDeps,
	) => Promise<EngineHandle>;
	activities: InngestEngineDeps["activities"];
	temporalActivities: WorkflowTemporalWorkerDeps["activities"];
	allowPrivateHosts: boolean;
	/** Names this process in Inngest; a connection id is appended. */
	instanceId: string;
	resolveHost?: ResolveHost;
	startDeadlineMs?: number;
}

/**
 * The two starters the connection manager calls. Each refuses an address on a
 * private network before dialing, unless the deployment allows it.
 */
export function createConnectionStarters(deps: ConnectionStartersDeps) {
	const deadlineMs = deps.startDeadlineMs ?? DEFAULT_START_DEADLINE_MS;
	const guard = (
		connection: InngestEngineConnection | TemporalEngineConnection,
	) =>
		assertConnectionHostAllowed({
			connection,
			allowPrivateHosts: deps.allowPrivateHosts,
			resolveHost: deps.resolveHost,
		});

	return {
		async startInngest(
			connection: InngestEngineConnection,
		): Promise<EngineHandle> {
			await guard(connection);
			return withStartDeadline({
				start: deps.startInngestEngine({
					client: {
						signingKey: connection.signingKey,
						baseUrl: connection.baseUrl,
						isDev: false,
					},
					instanceId: `${deps.instanceId}-${connection.id.slice(0, 8)}`,
					activities: deps.activities,
				}),
				deadlineMs,
				message: `Inngest did not accept the connection within ${Math.round(deadlineMs / 1000)} s.`,
			});
		},

		async startTemporal(
			connection: TemporalEngineConnection,
		): Promise<EngineHandle> {
			await guard(connection);
			return withStartDeadline({
				start: deps.startTemporalWorker({
					connection,
					activities: deps.temporalActivities,
				}),
				deadlineMs,
				message: `Temporal did not answer within ${Math.round(deadlineMs / 1000)} s.`,
			});
		},
	};
}

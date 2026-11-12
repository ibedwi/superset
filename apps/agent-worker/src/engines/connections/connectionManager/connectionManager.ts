import type {
	InngestEngineConnection,
	TemporalEngineConnection,
	WorkflowEngineConnection,
} from "@superset/shared/workflow-engine";
import type { WorkflowApi } from "../../../clients/workflowApi";
import type { EngineHandle } from "../../engineHandle";
import { logError } from "../../logError";

const DEFAULT_POLL_EVERY_MS = 30_000;
const DEFAULT_MAX_TEMPORAL_CONNECTIONS = 25;
const DEFAULT_RETRY_FAILED_AFTER_MS = 5 * 60_000;

export const TEMPORAL_LIMIT_MESSAGE =
	"This deployment has reached its limit of connected Temporal namespaces.";

export type ConnectionManagerApi = Pick<
	WorkflowApi,
	"listEngineConnections" | "reportEngineConnection"
>;

export interface ConnectionManagerDeps {
	api: ConnectionManagerApi;
	startInngest: (connection: InngestEngineConnection) => Promise<EngineHandle>;
	startTemporal: (
		connection: TemporalEngineConnection,
	) => Promise<EngineHandle>;
	/** Resolves after `ms`, or at once when `signal` aborts. */
	sleep: (args: { ms: number; signal: AbortSignal }) => Promise<void>;
	pollEveryMs?: number;
	maxTemporalConnections?: number;
	/** How long a connection that failed to start waits before the next try. */
	retryFailedAfterMs?: number;
	now?: () => number;
}

type Entry = {
	connection: WorkflowEngineConnection;
	handle: EngineHandle | null;
	failedAt: number | null;
	/** Failed only because of the limit: retried every cycle, no dial involved. */
	limited: boolean;
	reported: { status: "connected" | "error"; error: string | null } | null;
	delivered: boolean;
	stoppedByManager: boolean;
};

function failureMessage(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	return detail.slice(0, 1000);
}

/**
 * Keeps one engine running per organization connection. Every cycle it lists
 * the connections and starts, restarts or stops engines to match; a connection
 * is identified by its id and version, so an edit restarts it.
 */
export function startConnectionManager(
	deps: ConnectionManagerDeps,
): EngineHandle {
	const pollEveryMs = deps.pollEveryMs ?? DEFAULT_POLL_EVERY_MS;
	const maxTemporal =
		deps.maxTemporalConnections ?? DEFAULT_MAX_TEMPORAL_CONNECTIONS;
	const retryFailedAfterMs =
		deps.retryFailedAfterMs ?? DEFAULT_RETRY_FAILED_AFTER_MS;
	const now = deps.now ?? Date.now;

	const stopping = new AbortController();
	const entries = new Map<string, Entry>();

	const temporalInUseBesides = (self: Entry) =>
		[...entries.values()].filter(
			(entry) =>
				entry !== self &&
				entry.connection.provider === "temporal" &&
				entry.failedAt === null,
		).length;

	const deliverReport = async (args: { id: string; entry: Entry }) => {
		const { id, entry } = args;
		if (!entry.reported || entry.delivered) return;
		try {
			await deps.api.reportEngineConnection({
				connectionId: id,
				version: entry.connection.updatedAt,
				status: entry.reported.status,
				error: entry.reported.error,
			});
			entry.delivered = true;
		} catch (error) {
			logError({ message: `Could not report connection ${id}`, error });
		}
	};

	const setReported = (args: {
		entry: Entry;
		status: "connected" | "error";
		error: string | null;
	}) => {
		const { entry, status, error } = args;
		if (entry.reported?.status === status && entry.reported.error === error) {
			return;
		}
		entry.reported = { status, error };
		entry.delivered = false;
	};

	const markFailed = (args: {
		entry: Entry;
		message: string;
		limited?: boolean;
	}) => {
		const { entry } = args;
		entry.handle = null;
		entry.failedAt = now();
		entry.limited = args.limited ?? false;
		setReported({
			entry,
			status: "error",
			error: args.message,
		});
	};

	const watch = (args: { id: string; entry: Entry; handle: EngineHandle }) => {
		const { id, entry, handle } = args;
		handle.closed.then(
			() => {
				if (entry.stoppedByManager || entries.get(id) !== entry) return;
				markFailed({ entry, message: "The engine stopped unexpectedly." });
			},
			(error: unknown) => {
				if (entry.stoppedByManager || entries.get(id) !== entry) return;
				markFailed({ entry, message: failureMessage(error) });
			},
		);
	};

	const startEntry = async (args: { id: string; entry: Entry }) => {
		const { id, entry } = args;
		const { connection } = entry;
		if (
			connection.provider === "temporal" &&
			temporalInUseBesides(entry) >= maxTemporal
		) {
			markFailed({ entry, message: TEMPORAL_LIMIT_MESSAGE, limited: true });
			return;
		}
		entry.failedAt = null;
		entry.limited = false;
		try {
			const handle =
				connection.provider === "inngest"
					? await deps.startInngest(connection)
					: await deps.startTemporal(connection);
			if (entries.get(id) !== entry || stopping.signal.aborted) {
				await handle.stop();
				return;
			}
			entry.handle = handle;
			setReported({ entry, status: "connected", error: null });
			watch({ id, entry, handle });
		} catch (error) {
			logError({ message: `Connection ${id} did not start`, error });
			markFailed({ entry, message: failureMessage(error) });
		}
	};

	const stopEntry = async (entry: Entry) => {
		entry.stoppedByManager = true;
		try {
			await entry.handle?.stop();
		} catch (error) {
			logError({ message: "Stopping an engine failed", error });
		}
	};

	const reconcile = async () => {
		const connections = await deps.api.listEngineConnections();
		const desired = new Map(
			connections.map((connection) => [connection.id, connection]),
		);

		const stale = [...entries].filter(([id, entry]) => {
			const wanted = desired.get(id);
			return !wanted || wanted.updatedAt !== entry.connection.updatedAt;
		});
		await Promise.all(
			stale.map(async ([id, entry]) => {
				entries.delete(id);
				await stopEntry(entry);
			}),
		);

		const starts: Promise<void>[] = [];
		for (const [id, connection] of desired) {
			const existing = entries.get(id);
			if (!existing) {
				const entry: Entry = {
					connection,
					handle: null,
					failedAt: null,
					limited: false,
					reported: null,
					delivered: false,
					stoppedByManager: false,
				};
				entries.set(id, entry);
				starts.push(startEntry({ id, entry }));
				continue;
			}
			const retryDue =
				existing.failedAt !== null &&
				(existing.limited || now() - existing.failedAt >= retryFailedAfterMs);
			if (retryDue) {
				existing.stoppedByManager = false;
				starts.push(startEntry({ id, entry: existing }));
			}
		}
		await Promise.all(starts);
		await Promise.all(
			[...entries].map(([id, entry]) => deliverReport({ id, entry })),
		);
	};

	const loop = (async () => {
		while (!stopping.signal.aborted) {
			try {
				await reconcile();
			} catch (error) {
				logError({ message: "Listing engine connections failed", error });
			}
			await deps.sleep({ ms: pollEveryMs, signal: stopping.signal });
		}
	})();

	const closed = loop.then(async () => {
		await Promise.all([...entries.values()].map((entry) => stopEntry(entry)));
		entries.clear();
	});

	return {
		closed,
		isRunning: () => !stopping.signal.aborted,
		async stop() {
			stopping.abort();
			await closed;
		},
	};
}

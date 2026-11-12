import type {
	ActivityRuntime,
	WorkflowRunActivities,
} from "../../../activities/workflowActivities";
import type { WorkflowApi } from "../../../clients/workflowApi";
import type { EngineHandle } from "../../engineHandle";
import { createJournaledContext, RunCanceledError } from "../../journal";
import { logError } from "../../logError";
import { runGraph } from "../../runGraph";

const DEFAULT_POLL_EVERY_MS = 2000;
const DEFAULT_LEASE_SECONDS = 60;
const DEFAULT_MAX_CONCURRENT_RUNS = 10;
const DEFAULT_POLL_CHUNK_MS = 5 * 60_000;

export type PostgresEngineApi = Pick<
	WorkflowApi,
	| "claimRuns"
	| "renewLease"
	| "releaseLease"
	| "loadCheckpoints"
	| "saveCheckpoint"
>;

export interface PostgresEngineDeps {
	api: PostgresEngineApi;
	/** Builds the activities of one run; the runtime carries that run's abort signal. */
	activities: (runtime: () => ActivityRuntime) => WorkflowRunActivities;
	workerId: string;
	/** Resolves after `ms`, or at once when `signal` aborts. */
	sleep: (args: { ms: number; signal: AbortSignal }) => Promise<void>;
	pollEveryMs?: number;
	leaseSeconds?: number;
	maxConcurrentRuns?: number;
	pollChunkMs?: number;
	now?: () => number;
}

type Outcome = "finished" | "aborted" | "failed";

export async function startPostgresEngine(
	deps: PostgresEngineDeps,
): Promise<EngineHandle> {
	const pollEveryMs = deps.pollEveryMs ?? DEFAULT_POLL_EVERY_MS;
	const leaseSeconds = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
	const maxConcurrentRuns =
		deps.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
	const pollChunkMs = deps.pollChunkMs ?? DEFAULT_POLL_CHUNK_MS;
	const now = deps.now ?? Date.now;
	const renewEveryMs = (leaseSeconds * 1000) / 3;

	const stopping = new AbortController();
	const active = new Map<
		string,
		{ controller: AbortController; done: Promise<void> }
	>();

	const holdLease = async (args: {
		runId: string;
		controller: AbortController;
	}) => {
		const { signal } = args.controller;
		let renewedAt = now();
		while (!signal.aborted) {
			await deps.sleep({ ms: renewEveryMs, signal });
			if (signal.aborted) return;
			try {
				const { held } = await deps.api.renewLease({
					runId: args.runId,
					workerId: deps.workerId,
					leaseSeconds,
				});
				if (!held) return args.controller.abort();
				renewedAt = now();
			} catch (error) {
				logError({ message: `Lease renewal failed for ${args.runId}`, error });
				if (now() - renewedAt > leaseSeconds * 1000) {
					return args.controller.abort();
				}
			}
		}
	};

	const execute = async (args: {
		runId: string;
		controller: AbortController;
	}): Promise<Outcome> => {
		const { signal } = args.controller;
		const runtime: ActivityRuntime = {
			heartbeat: () => {},
			signal,
			sleep: (ms) => deps.sleep({ ms, signal }),
		};
		try {
			const ctx = await createJournaledContext({
				api: deps.api,
				activities: deps.activities(() => runtime),
				runId: args.runId,
				signal,
				sleep: (ms) => deps.sleep({ ms, signal }),
				pollChunkMs,
				now,
			});
			await runGraph({ ctx, runId: args.runId });
			return "finished";
		} catch (error) {
			if (error instanceof RunCanceledError) return "aborted";
			logError({ message: `Run ${args.runId} failed`, error });
			return "failed";
		}
	};

	const runOne = async (args: {
		runId: string;
		controller: AbortController;
	}) => {
		const { runId, controller } = args;
		const renewal = holdLease({ runId, controller });
		const outcome = await execute({ runId, controller });
		controller.abort();
		await renewal;
		if (outcome === "failed") return;
		try {
			await deps.api.releaseLease({ runId, workerId: deps.workerId });
		} catch (error) {
			logError({ message: `Could not release the lease of ${runId}`, error });
		}
	};

	const claim = async () => {
		const free = maxConcurrentRuns - active.size;
		if (free <= 0) return;
		const { runIds } = await deps.api.claimRuns({
			workerId: deps.workerId,
			limit: free,
			leaseSeconds,
		});
		for (const runId of runIds) {
			if (active.has(runId)) continue;
			const controller = new AbortController();
			if (stopping.signal.aborted) controller.abort();
			const done = runOne({ runId, controller }).finally(() =>
				active.delete(runId),
			);
			active.set(runId, { controller, done });
		}
	};

	const loop = (async () => {
		while (!stopping.signal.aborted) {
			try {
				await claim();
			} catch (error) {
				logError({ message: "Claiming runs failed", error });
			}
			await deps.sleep({ ms: pollEveryMs, signal: stopping.signal });
		}
	})();

	const settled = () =>
		Promise.all([...active.values()].map((run) => run.done));
	const closed = loop.then(settled).then(() => {});

	return {
		closed,
		isRunning: () => !stopping.signal.aborted,
		async stop() {
			stopping.abort();
			for (const run of active.values()) run.controller.abort();
			await closed;
		},
	};
}

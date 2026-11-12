import { describe, expect, test } from "bun:test";
import type { WorkflowGraph } from "@superset/shared/workflow-graph";
import { createMemoryCheckpoints } from "../../testing/memoryCheckpoints";
import { stubActivities } from "../../testing/stubActivities";
import { type PostgresEngineApi, startPostgresEngine } from "./postgresEngine";

const GRAPH: WorkflowGraph = {
	nodes: [
		{ id: "start", type: "trigger", position: { x: 0, y: 0 }, config: {} },
	],
	edges: [],
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function manualClock() {
	const waiting: Array<() => void> = [];
	return {
		sleep: ({ signal }: { ms: number; signal: AbortSignal }) =>
			new Promise<void>((resolve) => {
				if (signal.aborted) return resolve();
				waiting.push(resolve);
				signal.addEventListener("abort", () => resolve(), { once: true });
			}),
		async tick() {
			for (const resolve of waiting.splice(0)) resolve();
			await settle();
		},
	};
}

function setup(
	args: {
		claims?: string[][];
		held?: boolean;
		hang?: boolean;
		maxConcurrentRuns?: number;
	} = {},
) {
	const claims = [...(args.claims ?? [["run-1"]])];
	const calls = {
		claimLimits: [] as number[],
		renewed: [] as string[],
		released: [] as string[],
		statuses: [] as string[],
	};
	const checkpoints = createMemoryCheckpoints();
	const api: PostgresEngineApi = {
		...checkpoints,
		async claimRuns({ limit }) {
			calls.claimLimits.push(limit);
			return { runIds: claims.shift() ?? [] };
		},
		async renewLease({ runId }) {
			calls.renewed.push(runId);
			return { held: args.held ?? true };
		},
		async releaseLease({ runId }) {
			calls.released.push(runId);
			return { released: true };
		},
	};
	const clock = manualClock();
	const start = () =>
		startPostgresEngine({
			api,
			workerId: "worker-1",
			sleep: clock.sleep,
			maxConcurrentRuns: args.maxConcurrentRuns ?? 10,
			activities: () =>
				stubActivities({
					loadWorkflowRun: async () =>
						args.hang
							? new Promise(() => {})
							: { graph: GRAPH, triggerContext: null, title: "t" },
					recordRunStatus: async ({ status }) => {
						calls.statuses.push(status);
					},
					recordStep: async () => {},
				}),
		});
	return { start, clock, calls };
}

describe("startPostgresEngine", () => {
	test("runs a claimed run to succeeded", async () => {
		const { start, calls } = setup();
		const engine = await start();
		await settle();

		expect(calls.statuses).toEqual(["running", "succeeded"]);
		await engine.stop();
	});

	test("releases the lease of a finished run", async () => {
		const { start, calls } = setup();
		const engine = await start();
		await settle();

		expect(calls.released).toEqual(["run-1"]);
		await engine.stop();
	});

	test("asks only for as many runs as it has free slots", async () => {
		const { start, clock, calls } = setup({
			claims: [["run-1", "run-2"], []],
			hang: true,
			maxConcurrentRuns: 3,
		});
		const engine = await start();
		await settle();
		await clock.tick();

		expect(calls.claimLimits).toEqual([3, 1]);
		await engine.stop();
	});

	test("stops a run whose lease renewal says it is no longer held", async () => {
		const { start, clock, calls } = setup({ held: false, hang: true });
		const engine = await start();
		await settle();
		await clock.tick();

		expect(calls.renewed).toEqual(["run-1"]);
		expect(calls.released).toEqual(["run-1"]);
		await engine.stop();
	});

	test("writes no status for a run whose lease was lost", async () => {
		const { start, clock, calls } = setup({ held: false, hang: true });
		const engine = await start();
		await settle();
		await clock.tick();

		expect(calls.statuses).toEqual([]);
		await engine.stop();
	});

	test("stop releases the leases of runs in flight", async () => {
		const { start, calls } = setup({ hang: true });
		const engine = await start();
		await settle();

		await engine.stop();

		expect(calls.released).toEqual(["run-1"]);
	});

	test("stop writes no status for runs in flight", async () => {
		const { start, calls } = setup({ hang: true });
		const engine = await start();
		await settle();

		await engine.stop();

		expect(calls.statuses).toEqual([]);
	});

	test("reports not running after stop", async () => {
		const { start } = setup({ claims: [] });
		const engine = await start();
		expect(engine.isRunning()).toBe(true);

		await engine.stop();

		expect(engine.isRunning()).toBe(false);
	});

	test("resolves closed after stop", async () => {
		const { start } = setup({ claims: [] });
		const engine = await start();

		await engine.stop();

		await expect(engine.closed).resolves.toBeUndefined();
	});
});

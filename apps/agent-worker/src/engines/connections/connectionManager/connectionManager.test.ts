import { describe, expect, test } from "bun:test";
import type {
	InngestEngineConnection,
	TemporalEngineConnection,
	WorkflowEngineConnection,
} from "@superset/shared/workflow-engine";
import type { EngineHandle } from "../../engineHandle";
import {
	type ConnectionManagerApi,
	startConnectionManager,
	TEMPORAL_LIMIT_MESSAGE,
} from "./connectionManager";

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

const inngest = (id: string, updatedAt = "v1"): InngestEngineConnection => ({
	id,
	provider: "inngest",
	updatedAt,
	eventKey: "event-key",
	signingKey: "signing-key",
});

const temporal = (id: string, updatedAt = "v1"): TemporalEngineConnection => ({
	id,
	provider: "temporal",
	updatedAt,
	address: "temporal.example.com:7233",
	namespace: "ns",
	tls: false,
});

function fakeHandle() {
	let resolveClosed: () => void = () => {};
	let rejectClosed: (error: Error) => void = () => {};
	const closed = new Promise<void>((resolve, reject) => {
		resolveClosed = resolve;
		rejectClosed = reject;
	});
	const handle: EngineHandle & { stopped: number } = {
		stopped: 0,
		closed,
		isRunning: () => true,
		async stop() {
			handle.stopped++;
			resolveClosed();
		},
	};
	return {
		handle,
		crash: (message: string) => rejectClosed(new Error(message)),
	};
}

type Report = {
	connectionId: string;
	version: string;
	status: "connected" | "error";
	error?: string | null;
};

function setup(
	args: {
		maxTemporalConnections?: number;
		failStart?: (connection: WorkflowEngineConnection) => string | undefined;
		retryFailedAfterMs?: number;
	} = {},
) {
	let connections: WorkflowEngineConnection[] = [];
	let time = 0;
	const reports: Report[] = [];
	const started: string[] = [];
	const handles = new Map<string, ReturnType<typeof fakeHandle>[]>();
	const api: ConnectionManagerApi = {
		listEngineConnections: async () => connections,
		reportEngineConnection: async (input) => {
			reports.push(input);
			return { recorded: true };
		},
	};
	const start = async (connection: WorkflowEngineConnection) => {
		const failure = args.failStart?.(connection);
		if (failure) throw new Error(failure);
		started.push(`${connection.id}@${connection.updatedAt}`);
		const made = fakeHandle();
		handles.set(connection.id, [...(handles.get(connection.id) ?? []), made]);
		return made.handle;
	};
	const clock = manualClock();
	const manager = startConnectionManager({
		api,
		startInngest: start,
		startTemporal: start,
		sleep: clock.sleep,
		maxTemporalConnections: args.maxTemporalConnections ?? 25,
		retryFailedAfterMs: args.retryFailedAfterMs,
		now: () => time,
	});
	return {
		manager,
		clock,
		reports,
		started,
		handles,
		async sync(next: WorkflowEngineConnection[]) {
			connections = next;
			await settle();
			await clock.tick();
		},
		advance: (ms: number) => {
			time += ms;
		},
	};
}

describe("startConnectionManager", () => {
	test("a new connection starts an engine and reports connected", async () => {
		const t = setup();
		await t.sync([inngest("c1")]);

		expect(t.started).toEqual(["c1@v1"]);
		expect(t.reports).toEqual([
			{ connectionId: "c1", version: "v1", status: "connected", error: null },
		]);
		await t.manager.stop();
	});

	test("a connection that has not changed is not started again", async () => {
		const t = setup();
		await t.sync([inngest("c1")]);
		await t.clock.tick();
		await t.clock.tick();

		expect(t.started).toEqual(["c1@v1"]);
		await t.manager.stop();
	});

	test("a changed version stops the old engine and starts a new one", async () => {
		const t = setup();
		await t.sync([temporal("c1", "v1")]);
		await t.sync([temporal("c1", "v2")]);

		expect(t.handles.get("c1")?.[0]?.handle.stopped).toBe(1);
		expect(t.started).toEqual(["c1@v1", "c1@v2"]);
		expect(t.reports.at(-1)).toMatchObject({
			version: "v2",
			status: "connected",
		});
		await t.manager.stop();
	});

	test("a removed connection stops its engine", async () => {
		const t = setup();
		await t.sync([inngest("c1")]);
		await t.sync([]);

		expect(t.handles.get("c1")?.[0]?.handle.stopped).toBe(1);
		await t.manager.stop();
	});

	test("a starter that throws reports the error", async () => {
		const t = setup({ failStart: () => "namespace not found" });
		await t.sync([temporal("c1")]);

		expect(t.reports).toEqual([
			{
				connectionId: "c1",
				version: "v1",
				status: "error",
				error: "namespace not found",
			},
		]);
		await t.manager.stop();
	});

	test("a failed connection is not dialed again before the retry delay", async () => {
		let attempts = 0;
		const t = setup({
			failStart: () => {
				attempts++;
				return "unreachable";
			},
			retryFailedAfterMs: 1000,
		});
		await t.sync([temporal("c1")]);
		t.advance(999);
		await t.clock.tick();

		expect(attempts).toBe(1);
		await t.manager.stop();
	});

	test("a failed connection is retried after the delay and reports connected", async () => {
		let failing = true;
		const t = setup({
			failStart: () => (failing ? "unreachable" : undefined),
			retryFailedAfterMs: 1000,
		});
		await t.sync([temporal("c1")]);
		failing = false;
		t.advance(1000);
		await t.clock.tick();

		expect(t.reports.map((report) => report.status)).toEqual([
			"error",
			"connected",
		]);
		await t.manager.stop();
	});

	test("the Temporal limit is enforced and named in the error", async () => {
		const t = setup({ maxTemporalConnections: 1 });
		await t.sync([temporal("c1"), temporal("c2")]);

		expect(t.started).toEqual(["c1@v1"]);
		expect(t.reports).toContainEqual({
			connectionId: "c2",
			version: "v1",
			status: "error",
			error: TEMPORAL_LIMIT_MESSAGE,
		});
		await t.manager.stop();
	});

	test("the Temporal limit does not count Inngest connections", async () => {
		const t = setup({ maxTemporalConnections: 1 });
		await t.sync([inngest("c1"), temporal("c2")]);

		expect(t.started).toEqual(["c1@v1", "c2@v1"]);
		await t.manager.stop();
	});

	test("a limited connection starts once a slot is free", async () => {
		const t = setup({ maxTemporalConnections: 1 });
		await t.sync([temporal("c1"), temporal("c2")]);
		await t.sync([temporal("c2")]);

		expect(t.started).toEqual(["c1@v1", "c2@v1"]);
		await t.manager.stop();
	});

	test("a limited connection reports its error only once", async () => {
		const t = setup({ maxTemporalConnections: 1 });
		await t.sync([temporal("c1"), temporal("c2")]);
		await t.clock.tick();
		await t.clock.tick();

		const limited = t.reports.filter((report) => report.connectionId === "c2");
		expect(limited).toHaveLength(1);
		await t.manager.stop();
	});

	test("an engine that crashes is reported as an error", async () => {
		const t = setup();
		await t.sync([temporal("c1")]);
		t.handles.get("c1")?.[0]?.crash("poller failed");
		await settle();
		await t.clock.tick();

		expect(t.reports.at(-1)).toMatchObject({
			connectionId: "c1",
			status: "error",
			error: "poller failed",
		});
		await t.manager.stop();
	});

	test("stop stops every engine", async () => {
		const t = setup();
		await t.sync([inngest("c1"), temporal("c2")]);
		await t.manager.stop();

		expect(t.handles.get("c1")?.[0]?.handle.stopped).toBe(1);
		expect(t.handles.get("c2")?.[0]?.handle.stopped).toBe(1);
	});

	test("stopping an engine is not reported as a crash", async () => {
		const t = setup();
		await t.sync([inngest("c1")]);
		await t.manager.stop();

		expect(t.reports.map((report) => report.status)).toEqual(["connected"]);
	});

	test("a failing list keeps the engines that are running", async () => {
		const t = setup();
		await t.sync([inngest("c1")]);
		await t.sync(undefined as never);

		expect(t.handles.get("c1")?.[0]?.handle.stopped).toBe(0);
		await t.manager.stop();
	});

	test("a report that failed to deliver is sent again next cycle", async () => {
		let failReports = true;
		const delivered: Report[] = [];
		const clock = manualClock();
		const handle = fakeHandle().handle;
		const manager = startConnectionManager({
			api: {
				listEngineConnections: async () => [inngest("c1")],
				reportEngineConnection: async (input) => {
					if (failReports) throw new Error("api down");
					delivered.push(input);
					return { recorded: true };
				},
			},
			startInngest: async () => handle,
			startTemporal: async () => handle,
			sleep: clock.sleep,
		});
		await settle();
		failReports = false;
		await clock.tick();

		expect(delivered).toHaveLength(1);
		await manager.stop();
	});

	test("isRunning is false after stop", async () => {
		const t = setup();
		await settle();
		await t.manager.stop();

		expect(t.manager.isRunning()).toBe(false);
	});
});

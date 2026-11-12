import { describe, expect, test } from "bun:test";
import { NodeError } from "../../nodeError";
import { createMemoryCheckpoints } from "../../testing/memoryCheckpoints";
import { stubActivities } from "../../testing/stubActivities";
import { createJournaledContext } from "./journaledContext";

const RUN = "run-1";
const HTTP_INPUT = {
	method: "GET",
	url: "https://example.com",
	headers: {},
	timeoutSeconds: 5,
};
const HTTP_OK = { status: 200, body: "ok" };
const OPTIONS = { key: "fetch:http", timeoutMs: 1000, attempts: 3 };

const noSleep = async () => {};

function build(args: {
	api: ReturnType<typeof createMemoryCheckpoints>;
	callHttpNode?: () => Promise<typeof HTTP_OK>;
	signal?: AbortSignal;
	sleep?: (ms: number) => Promise<void>;
	now?: () => number;
}) {
	return createJournaledContext({
		api: args.api,
		activities: stubActivities({
			callHttpNode: args.callHttpNode ?? (async () => HTTP_OK),
		}),
		runId: RUN,
		signal: args.signal ?? new AbortController().signal,
		sleep: args.sleep ?? noSleep,
		pollChunkMs: 1000,
		...(args.now ? { now: args.now } : {}),
	});
}

describe("createJournaledContext", () => {
	test("saves the result of a finished call", async () => {
		const api = createMemoryCheckpoints();
		const ctx = await build({ api });

		await ctx.call("callHttpNode", HTTP_INPUT, OPTIONS);

		expect(api.rows.get(RUN)?.get("fetch:http")).toEqual(HTTP_OK);
	});

	test("a second context for the same run skips a call that has a checkpoint", async () => {
		const api = createMemoryCheckpoints();
		const first = await build({ api });
		await first.call("callHttpNode", HTTP_INPUT, OPTIONS);
		let calls = 0;
		const second = await build({
			api,
			callHttpNode: async () => {
				calls++;
				return HTTP_OK;
			},
		});

		const result = await second.call("callHttpNode", HTTP_INPUT, OPTIONS);

		expect(calls).toBe(0);
		expect(result).toEqual(HTTP_OK);
	});

	test("retries a failing call with growing waits until it succeeds", async () => {
		const api = createMemoryCheckpoints();
		const waits: number[] = [];
		let calls = 0;
		const ctx = await build({
			api,
			sleep: async (ms) => {
				waits.push(ms);
			},
			callHttpNode: async () => {
				calls++;
				if (calls < 3) throw new Error("network down");
				return HTTP_OK;
			},
		});

		const result = await ctx.call("callHttpNode", HTTP_INPUT, OPTIONS);

		expect(result).toEqual(HTTP_OK);
		expect(waits).toEqual([1000, 2000]);
	});

	test("stops after the last attempt and stores nothing", async () => {
		const api = createMemoryCheckpoints();
		let calls = 0;
		const ctx = await build({
			api,
			callHttpNode: async () => {
				calls++;
				throw new Error("network down");
			},
		});

		await expect(ctx.call("callHttpNode", HTTP_INPUT, OPTIONS)).rejects.toThrow(
			"network down",
		);

		expect(calls).toBe(3);
		expect(api.saves).toEqual([]);
	});

	test("does not retry a NodeError that is not retryable", async () => {
		const api = createMemoryCheckpoints();
		let calls = 0;
		const ctx = await build({
			api,
			callHttpNode: async () => {
				calls++;
				throw new NodeError({
					message: "bad url",
					code: "BadHttpNode",
					retryable: false,
				});
			},
		});

		await expect(ctx.call("callHttpNode", HTTP_INPUT, OPTIONS)).rejects.toThrow(
			"bad url",
		);

		expect(calls).toBe(1);
	});

	test("fails a try that outlasts its timeout with timedOut", async () => {
		const api = createMemoryCheckpoints();
		const ctx = await build({
			api,
			callHttpNode: () => new Promise(() => {}),
		});

		const error = await ctx
			.call("callHttpNode", HTTP_INPUT, {
				...OPTIONS,
				timeoutMs: 5,
				attempts: 1,
			})
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NodeError);
		expect((error as NodeError).timedOut).toBe(true);
	});

	test("rejects a pending call when the signal aborts", async () => {
		const api = createMemoryCheckpoints();
		const controller = new AbortController();
		const ctx = await build({
			api,
			signal: controller.signal,
			callHttpNode: () => new Promise(() => {}),
		});

		const pending = ctx
			.call("callHttpNode", HTTP_INPUT, OPTIONS)
			.catch((caught: unknown) => caught);
		controller.abort();

		expect(ctx.isCancellation(await pending)).toBe(true);
	});

	test("rejects a later call after the signal aborted", async () => {
		const api = createMemoryCheckpoints();
		const controller = new AbortController();
		const ctx = await build({ api, signal: controller.signal });
		controller.abort();

		const error = await ctx
			.call("callHttpNode", HTTP_INPUT, OPTIONS)
			.catch((caught: unknown) => caught);

		expect(ctx.isCancellation(error)).toBe(true);
	});

	test("does not treat an ordinary error as a cancellation", async () => {
		const ctx = await build({ api: createMemoryCheckpoints() });

		expect(ctx.isCancellation(new Error("boom"))).toBe(false);
	});
});

describe("createJournaledContext sleep", () => {
	test("waits for the whole time on the first run", async () => {
		const waits: number[] = [];
		const ctx = await build({
			api: createMemoryCheckpoints(),
			now: () => 10_000,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});

		await ctx.sleep("nap", 5000);

		expect(waits).toEqual([5000]);
	});

	test("a restarted run waits only for the remainder", async () => {
		const api = createMemoryCheckpoints();
		const first = await build({ api, now: () => 10_000 });
		await first.sleep("nap", 5000);
		const waits: number[] = [];
		const second = await build({
			api,
			now: () => 13_000,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});

		await second.sleep("nap", 5000);

		expect(waits).toEqual([2000]);
	});

	test("does not wait when the wake-up time has passed", async () => {
		const api = createMemoryCheckpoints();
		const first = await build({ api, now: () => 10_000 });
		await first.sleep("nap", 5000);
		const waits: number[] = [];
		const second = await build({
			api,
			now: () => 99_000,
			sleep: async (ms) => {
				waits.push(ms);
			},
		});

		await second.sleep("nap", 5000);

		expect(waits).toEqual([]);
	});
});

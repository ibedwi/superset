import { describe, expect, test } from "bun:test";
import { NonRetriableError } from "inngest";
import { NodeError } from "../../nodeError";
import { stubActivities } from "../../testing/stubActivities";
import { WorkerStoppingError } from "../workerStopping";
import { createInngestContext, type InngestStep } from "./inngestContext";

function fakeStep() {
	const memo = new Map<string, unknown>();
	const sleeps: Array<{ id: string; ms: number }> = [];
	const step: InngestStep = {
		async run(id, handler) {
			if (memo.has(id)) return memo.get(id);
			const result = await handler();
			memo.set(id, result);
			return result;
		},
		async sleep(id, ms) {
			sleeps.push({ id, ms });
		},
	};
	return { step, sleeps };
}

const OPTIONS = { key: "node:op", timeoutMs: 1000, attempts: 3 };
const RECORD = { runId: "run-1", status: "running" } as const;

describe("createInngestContext", () => {
	test("runs the activity inside a step and returns its result", async () => {
		const { step } = fakeStep();
		const ctx = createInngestContext({
			step,
			activities: stubActivities({
				callLlmNode: async () => ({ text: "hello" }),
			}),
		});
		const result = await ctx.call(
			"callLlmNode",
			{ runId: "run-1", prompt: "hi", model: "m", maxTokens: 10 },
			OPTIONS,
		);
		expect(result).toEqual({ text: "hello" });
	});

	test("does not run an activity again when its step is memoized", async () => {
		const { step } = fakeStep();
		let calls = 0;
		const activities = stubActivities({
			recordRunStatus: async () => {
				calls++;
			},
		});
		const first = createInngestContext({ step, activities });
		const replay = createInngestContext({ step, activities });
		await first.call("recordRunStatus", RECORD, OPTIONS);
		await replay.call("recordRunStatus", RECORD, OPTIONS);
		expect(calls).toBe(1);
	});

	test("retries a failing activity inside the step with backoff", async () => {
		const { step } = fakeStep();
		const waits: number[] = [];
		let calls = 0;
		const ctx = createInngestContext({
			step,
			sleep: async (ms) => {
				waits.push(ms);
			},
			activities: stubActivities({
				recordRunStatus: async () => {
					calls++;
					if (calls < 3) throw new Error("flaky");
				},
			}),
		});
		await ctx.call("recordRunStatus", RECORD, OPTIONS);
		expect({ calls, waits }).toEqual({ calls: 3, waits: [1000, 2000] });
	});

	test("stops at once on a non-retryable NodeError", async () => {
		const { step } = fakeStep();
		let calls = 0;
		const ctx = createInngestContext({
			step,
			activities: stubActivities({
				recordRunStatus: async () => {
					calls++;
					throw new NodeError({
						message: "bad input",
						code: "BadInput",
						retryable: false,
					});
				},
			}),
		});
		await ctx
			.call("recordRunStatus", RECORD, OPTIONS)
			.catch((error: unknown) => error);
		expect(calls).toBe(1);
	});

	test("gives up with a NonRetriableError inside the step", async () => {
		let thrown: unknown;
		const step: InngestStep = {
			async run(_id, handler) {
				try {
					return await handler();
				} catch (error) {
					thrown = error;
					throw error;
				}
			},
			sleep: async () => {},
		};
		const ctx = createInngestContext({
			step,
			sleep: async () => {},
			activities: stubActivities({
				recordRunStatus: async () => {
					throw new Error("always");
				},
			}),
		});
		await ctx
			.call("recordRunStatus", RECORD, OPTIONS)
			.catch((error: unknown) => error);
		expect(thrown).toBeInstanceOf(NonRetriableError);
	});

	test("surfaces the NodeError code to the graph", async () => {
		const { step } = fakeStep();
		const ctx = createInngestContext({
			step,
			activities: stubActivities({
				recordRunStatus: async () => {
					throw new NodeError({
						message: "bad input",
						code: "BadInput",
						retryable: false,
					});
				},
			}),
		});
		const error = await ctx
			.call("recordRunStatus", RECORD, OPTIONS)
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({
			name: "NodeError",
			code: "BadInput",
			message: "bad input",
			timedOut: false,
		});
	});

	test("marks a try that outlasts its timeout as timed out", async () => {
		const { step } = fakeStep();
		const ctx = createInngestContext({
			step,
			activities: stubActivities({
				recordRunStatus: () => new Promise<void>(() => {}),
			}),
		});
		const error = await ctx
			.call("recordRunStatus", RECORD, {
				...OPTIONS,
				timeoutMs: 1,
				attempts: 1,
			})
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ timedOut: true });
	});

	test("rethrows an error that did not come from a step", async () => {
		const failure = new Error("engine down");
		const step: InngestStep = {
			run: async () => {
				throw failure;
			},
			sleep: async () => {},
		};
		const ctx = createInngestContext({ step, activities: stubActivities() });
		const error = await ctx
			.call("recordRunStatus", RECORD, OPTIONS)
			.catch((caught: unknown) => caught);
		expect(error).toBe(failure);
	});

	test("sleeps through step.sleep with the given key", async () => {
		const { step, sleeps } = fakeStep();
		const ctx = createInngestContext({ step, activities: stubActivities() });
		await ctx.sleep("wait:1", 5000);
		expect(sleeps).toEqual([{ id: "wait:1", ms: 5000 }]);
	});

	test("polls in chunks of 30 minutes", () => {
		const { step } = fakeStep();
		const ctx = createInngestContext({ step, activities: stubActivities() });
		expect(ctx.pollChunkMs).toBe(30 * 60_000);
	});
});

describe("createInngestContext on shutdown", () => {
	function failingStep() {
		let thrown: unknown;
		const step: InngestStep = {
			async run(_id, handler) {
				try {
					return await handler();
				} catch (error) {
					thrown = error;
					throw error;
				}
			},
			sleep: async () => {},
		};
		return { step, thrown: () => thrown };
	}

	test("an activity interrupted by shutdown fails the step retryably", async () => {
		const { step, thrown } = failingStep();
		const shutdown = new AbortController();
		const ctx = createInngestContext({
			step,
			shutdown: shutdown.signal,
			activities: stubActivities({
				recordRunStatus: () => {
					shutdown.abort();
					return new Promise<void>(() => {});
				},
			}),
		});
		await ctx.call("recordRunStatus", RECORD, OPTIONS).catch(() => {});
		expect(thrown()).toBeInstanceOf(WorkerStoppingError);
		expect(thrown()).not.toBeInstanceOf(NonRetriableError);
	});

	test("a NodeError raised after the abort is still retryable", async () => {
		const { step, thrown } = failingStep();
		const shutdown = new AbortController();
		const ctx = createInngestContext({
			step,
			shutdown: shutdown.signal,
			activities: stubActivities({
				awaitAgentNode: async () => {
					shutdown.abort();
					throw new NodeError({
						message: "Activity cancelled",
						code: "Cancelled",
						retryable: false,
					});
				},
			}),
		});
		await ctx
			.call(
				"awaitAgentNode",
				{
					runId: "run-1",
					handle: { hostId: "h", workspaceId: "w", terminalId: "t" },
					budgetMs: 1000,
				},
				OPTIONS,
			)
			.catch(() => {});
		expect(thrown()).toBeInstanceOf(WorkerStoppingError);
	});

	test("without a shutdown a failure still gives up for good", async () => {
		const { step, thrown } = failingStep();
		const ctx = createInngestContext({
			step,
			sleep: async () => {},
			activities: stubActivities({
				recordRunStatus: async () => {
					throw new Error("always");
				},
			}),
		});
		await ctx.call("recordRunStatus", RECORD, OPTIONS).catch(() => {});
		expect(thrown()).toBeInstanceOf(NonRetriableError);
	});
});

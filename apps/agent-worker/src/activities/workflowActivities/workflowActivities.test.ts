import { describe, expect, test } from "bun:test";
import type {
	AgentState,
	JobStatus,
	WorkflowApi,
} from "../../clients/workflowApi";
import { createWorkflowActivities } from "./workflowActivities";

const handle = { hostId: "host", workspaceId: "ws-1", terminalId: "term-1" };

function activitiesObserving(states: AgentState[]) {
	let clock = 0;
	const observed = [...states];
	const api = {
		observeAgent: async () => ({ state: observed.shift() ?? "starting" }),
	} as unknown as WorkflowApi;
	return createWorkflowActivities({
		api,
		pollEveryMs: 0,
		startTimeoutMs: 30,
		now: () => {
			clock += 10;
			return clock;
		},
	});
}

test("dispatches agent launch options with the result instruction", async () => {
	let dispatched: unknown;
	const api = {
		dispatchAgent: async (input: unknown) => {
			dispatched = input;
			return handle;
		},
	} as unknown as WorkflowApi;
	const activities = createWorkflowActivities({ api });
	await activities.dispatchAgentNode({
		runId: "run",
		nodeId: "build",
		agent: "codex",
		model: "gpt-6.1-sol",
		effort: "high",
		prompt: "Build it",
		target: { hostId: "host" },
	});
	expect(dispatched).toMatchObject({
		agent: "codex",
		model: "gpt-6.1-sol",
		effort: "high",
		target: { hostId: "host" },
	});
	expect((dispatched as { prompt: string }).prompt).toStartWith("Build it");
	expect((dispatched as { prompt: string }).prompt).toContain(
		".superset/workflow/result.json",
	);
});

describe("awaitAgentNode", () => {
	test("fails an agent that never leaves starting", async () => {
		const activities = activitiesObserving([]);
		await expect(
			activities.awaitAgentNode({ runId: "run", handle, budgetMs: 1_000_000 }),
		).rejects.toMatchObject({ code: "AgentNotStarted", retryable: false });
	});

	test("does not time out an agent that started", async () => {
		const activities = activitiesObserving([
			"starting",
			"working",
			"working",
			"working",
			"working",
			"idle",
		]);
		await expect(
			activities.awaitAgentNode({ runId: "run", handle, budgetMs: 1_000_000 }),
		).resolves.toEqual({ settled: true, state: "idle" });
	});
});

test("passes LLM model and effort to the API", async () => {
	let received: unknown;
	const api = {
		llmCall: async (input: unknown) => {
			received = input;
			return { text: "summary" };
		},
	} as unknown as WorkflowApi;
	const activities = createWorkflowActivities({ api });
	const input = {
		runId: "run",
		prompt: "Summarize",
		model: "claude-sonnet-4-6",
		effort: "high" as const,
		maxTokens: 4096,
	};
	expect(await activities.callLlmNode(input)).toEqual({ text: "summary" });
	expect(received).toEqual(input);
});

test("awaitAgentNode returns unsettled when the budget is used", async () => {
	const activities = activitiesObserving(["working", "working", "working"]);
	await expect(
		activities.awaitAgentNode({ runId: "run", handle, budgetMs: 15 }),
	).resolves.toEqual({ settled: false });
});

describe("pollCliNode", () => {
	function activitiesPolling(outputs: { status: JobStatus; chunk: string }[]) {
		const fromOffsets: number[] = [];
		const remaining = [...outputs];
		let nextOffset = 0;
		const api = {
			pollHostJob: async (input: { fromOffset: number }) => {
				fromOffsets.push(input.fromOffset);
				const output = remaining.shift() ?? { status: "running", chunk: "" };
				nextOffset += output.chunk.length;
				return { ...output, nextOffset, exitCode: null };
			},
		} as unknown as WorkflowApi;
		let clock = 0;
		const activities = createWorkflowActivities({
			api,
			pollEveryMs: 0,
			now: () => {
				clock += 10;
				return clock;
			},
		});
		return { activities, fromOffsets };
	}
	const job = { runId: "run", hostId: "host", jobId: "job" };

	test("returns running with the next offset when the budget is used", async () => {
		const { activities } = activitiesPolling([
			{ status: "running", chunk: "abc" },
		]);
		await expect(
			activities.pollCliNode({ ...job, offset: 0, budgetMs: 5 }),
		).resolves.toMatchObject({ status: "running", tail: "abc", offset: 3 });
	});

	test("continues from the offset it is given", async () => {
		const { activities, fromOffsets } = activitiesPolling([
			{ status: "done", chunk: "x" },
		]);
		await activities.pollCliNode({ ...job, offset: 42, budgetMs: 1_000 });
		expect(fromOffsets).toEqual([42]);
	});
});

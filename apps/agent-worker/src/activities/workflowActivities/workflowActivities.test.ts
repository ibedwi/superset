import { describe, expect, test } from "bun:test";
import type { AgentState, WorkflowApi } from "../../clients/workflowApi";
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
			activities.awaitAgentNode({ runId: "run", handle }),
		).rejects.toMatchObject({ type: "AgentNotStarted", nonRetryable: true });
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
			activities.awaitAgentNode({ runId: "run", handle }),
		).resolves.toEqual({ state: "idle" });
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

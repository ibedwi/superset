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

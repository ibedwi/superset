import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { WorkflowGraph } from "@superset/shared/workflow-graph";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { WorkflowRunActivities } from "../../activities/workflowActivities";

type Call = { name: string; input: Record<string, unknown> };

let env: TestWorkflowEnvironment;

before(async () => {
	env = await TestWorkflowEnvironment.createTimeSkipping();
});

after(async () => {
	await env?.teardown();
});

const trigger = {
	id: "start",
	type: "trigger",
	position: { x: 0, y: 0 },
	config: {},
} as const;

function agentNode(id: string, timeoutMinutes = 60) {
	return {
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		config: {
			agent: "claude",
			prompt: `do ${id}`,
			target: { hostId: "h1" },
			timeoutMinutes,
		},
	} as const;
}

function httpNode(id: string) {
	return {
		id,
		type: "http",
		position: { x: 0, y: 0 },
		config: {
			method: "GET" as const,
			url: "https://api.example.com/x",
			headers: {},
			timeoutSeconds: 30,
		},
	} as const;
}

function edge(source: string, target: string, sourceHandle?: "true" | "false") {
	return {
		id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ""}`,
		source,
		target,
		...(sourceHandle ? { sourceHandle } : {}),
	};
}

interface Script {
	graph: WorkflowGraph;
	triggerContext?: unknown;
	agentHangs?: boolean;
	agentNeverSettles?: boolean;
	httpFails?: boolean;
	llmJson?: unknown;
}

function fakeActivities(
	script: Script,
	calls: Call[],
	hooks: { agentCancelled?: () => void } = {},
): WorkflowRunActivities {
	const push = (name: string, input: Record<string, unknown>) => {
		calls.push({ name, input: { ...input } });
	};
	return {
		async loadWorkflowRun(input) {
			push("loadWorkflowRun", input);
			return {
				graph: script.graph,
				triggerContext: script.triggerContext ?? null,
				title: "test",
			};
		},
		async recordRunStatus(input) {
			push("recordRunStatus", input);
		},
		async recordStep(input) {
			push("recordStep", input as Record<string, unknown>);
		},
		async dispatchAgentNode(input) {
			push("dispatchAgentNode", input);
			return {
				hostId: "h1",
				workspaceId: "w1",
				terminalId: `t-${input.nodeId}`,
			};
		},
		async awaitAgentNode(input) {
			push("awaitAgentNode", input as Record<string, unknown>);
			if (script.agentHangs) {
				const context = Context.current();
				try {
					for (;;) {
						context.heartbeat();
						await context.sleep(100);
					}
				} finally {
					hooks.agentCancelled?.();
				}
			}
			if (script.agentNeverSettles) return { settled: false as const };
			return { settled: true as const, state: "idle" as const };
		},
		async captureAgentOutput(input) {
			push("captureAgentOutput", input as Record<string, unknown>);
			return { json: { ok: true }, text: "done" };
		},
		async execCliNode(input) {
			push("execCliNode", input);
			return { jobId: `job-${input.nodeId}` };
		},
		async pollCliNode(input) {
			push("pollCliNode", input);
			return {
				status: "done" as const,
				exitCode: 0,
				tail: "ok\n",
				offset: 3,
			};
		},
		async killCliNode(input) {
			push("killCliNode", input);
		},
		async callLlmNode(input) {
			push("callLlmNode", input as Record<string, unknown>);
			return { text: "answer", json: script.llmJson };
		},
		async callHttpNode(input) {
			push("callHttpNode", input as Record<string, unknown>);
			if (script.httpFails) {
				throw ApplicationFailure.nonRetryable(
					"HTTP 404 from api.example.com",
					"HttpNodeClientError",
				);
			}
			return { status: 200, body: "{}", json: {} };
		},
	};
}

async function runWorkflow(
	activities: WorkflowRunActivities,
	runId: string,
	options: { cancelAfter?: () => Promise<void> } = {},
) {
	const worker = await Worker.create({
		connection: env.nativeConnection,
		taskQueue: "agent",
		defaultHeartbeatThrottleInterval: 50,
		maxHeartbeatThrottleInterval: 50,
		workflowsPath: fileURLToPath(new URL("../index.ts", import.meta.url)),
		activities,
	});
	return worker.runUntil(async () => {
		const handle = await env.client.workflow.start("workflowRun", {
			workflowId: `workflow-run-${runId}`,
			taskQueue: "agent",
			args: [{ runId }],
		});
		if (options.cancelAfter) {
			await options.cancelAfter();
			await handle.cancel();
		}
		return handle.result().then(
			() => ({ outcome: "completed" as const }),
			(error: unknown) => ({ outcome: "failed" as const, error }),
		);
	});
}

const names = (calls: Call[]) => calls.map((call) => call.name);
const steps = (calls: Call[]) =>
	calls
		.filter((call) => call.name === "recordStep")
		.map((call) => `${call.input.nodeId}:${call.input.status}`);
const runStatuses = (calls: Call[]) =>
	calls
		.filter((call) => call.name === "recordRunStatus")
		.map((call) => call.input.status);

async function waitFor(check: () => boolean) {
	for (let i = 0; i < 400; i++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error("condition not met");
}

describe("workflowRun workflow", () => {
	it("runs a linear graph and records each step", async () => {
		const graph: WorkflowGraph = {
			nodes: [
				trigger,
				{
					...agentNode("build"),
					config: {
						...agentNode("build").config,
						model: "opus",
						effort: "high",
					},
				},
				httpNode("notify"),
			],
			edges: [edge("start", "build"), edge("build", "notify")],
		};
		const calls: Call[] = [];
		const result = await runWorkflow(fakeActivities({ graph }, calls), "r1");
		assert.equal(result.outcome, "completed");
		assert.deepEqual(runStatuses(calls), ["running", "succeeded"]);
		assert.deepEqual(steps(calls), [
			"start:running",
			"start:succeeded",
			"build:running",
			"build:succeeded",
			"notify:running",
			"notify:succeeded",
		]);
		const dispatched = calls.find((c) => c.name === "dispatchAgentNode");
		assert.equal(dispatched?.input.prompt, "do build");
		assert.equal(dispatched?.input.model, "opus");
		assert.equal(dispatched?.input.effort, "high");
	});

	it("passes LLM model and effort through the workflow", async () => {
		const graph: WorkflowGraph = {
			nodes: [
				trigger,
				{
					id: "summarize",
					type: "llm",
					position: { x: 200, y: 0 },
					config: {
						prompt: "Summarize",
						model: "claude-opus-4-6",
						effort: "max",
						maxTokens: 4096,
					},
				},
			],
			edges: [edge("start", "summarize")],
		};
		const calls: Call[] = [];
		const result = await runWorkflow(
			fakeActivities({ graph }, calls),
			"llm-options",
		);
		assert.equal(result.outcome, "completed");
		const call = calls.find((entry) => entry.name === "callLlmNode");
		assert.equal(call?.input.model, "claude-opus-4-6");
		assert.equal(call?.input.effort, "max");
	});

	it("runs parallel branches in one wave", async () => {
		const graph: WorkflowGraph = {
			nodes: [trigger, agentNode("a"), agentNode("b"), httpNode("join")],
			edges: [
				edge("start", "a"),
				edge("start", "b"),
				edge("a", "join"),
				edge("b", "join"),
			],
		};
		const calls: Call[] = [];
		const result = await runWorkflow(fakeActivities({ graph }, calls), "r2");
		assert.equal(result.outcome, "completed");
		const dispatchIndexes = calls
			.map((call, index) => (call.name === "dispatchAgentNode" ? index : -1))
			.filter((index) => index >= 0);
		assert.equal(dispatchIndexes.length, 2);
		const joinIndex = calls.findIndex((call) => call.name === "callHttpNode");
		assert.ok(dispatchIndexes.every((index) => index < joinIndex));
		assert.ok(steps(calls).includes("join:succeeded"));
	});

	it("skips the untaken condition branch and everything behind it", async () => {
		const graph: WorkflowGraph = {
			nodes: [
				trigger,
				{
					id: "gate",
					type: "condition",
					position: { x: 0, y: 0 },
					config: {
						expression: {
							left: { ref: "trigger.go" },
							op: "truthy" as const,
						},
					},
				},
				agentNode("yes"),
				agentNode("no"),
				httpNode("after-no"),
			],
			edges: [
				edge("start", "gate"),
				edge("gate", "yes", "true"),
				edge("gate", "no", "false"),
				edge("no", "after-no"),
			],
		};
		const calls: Call[] = [];
		const result = await runWorkflow(
			fakeActivities({ graph, triggerContext: { go: true } }, calls),
			"r3",
		);
		assert.equal(result.outcome, "completed");
		const recorded = steps(calls);
		assert.ok(recorded.includes("yes:succeeded"));
		assert.ok(recorded.includes("no:skipped"));
		assert.ok(recorded.includes("after-no:skipped"));
		assert.ok(!names(calls).includes("execCliNode"));
		assert.equal(calls.filter((c) => c.name === "dispatchAgentNode").length, 1);
		assert.deepEqual(runStatuses(calls), ["running", "succeeded"]);
	});

	it("fails the run when a node fails", async () => {
		const graph: WorkflowGraph = {
			nodes: [trigger, httpNode("call"), agentNode("never")],
			edges: [edge("start", "call"), edge("call", "never")],
		};
		const calls: Call[] = [];
		const result = await runWorkflow(
			fakeActivities({ graph, httpFails: true }, calls),
			"r4",
		);
		assert.equal(result.outcome, "completed");
		assert.ok(steps(calls).includes("call:failed"));
		assert.ok(!names(calls).includes("dispatchAgentNode"));
		assert.deepEqual(runStatuses(calls), ["running", "failed"]);
		const failed = calls.find(
			(c) => c.name === "recordRunStatus" && c.input.status === "failed",
		);
		assert.match(String(failed?.input.error), /HTTP 404/);
	});

	it("times out an agent node that outlives its timeout", async () => {
		const graph: WorkflowGraph = {
			nodes: [trigger, agentNode("slow", 1)],
			edges: [edge("start", "slow")],
		};
		const calls: Call[] = [];
		const result = await runWorkflow(
			fakeActivities({ graph, agentNeverSettles: true }, calls),
			"r5",
		);
		assert.equal(result.outcome, "completed");
		assert.ok(steps(calls).includes("slow:failed"));
		assert.deepEqual(runStatuses(calls), ["running", "timed_out"]);
	});

	it("stops a running agent node on cancel and leaves the statuses to the API", async () => {
		const graph: WorkflowGraph = {
			nodes: [trigger, agentNode("long", 240)],
			edges: [edge("start", "long")],
		};
		const calls: Call[] = [];
		let cancelled = false;
		const activities = fakeActivities({ graph, agentHangs: true }, calls, {
			agentCancelled: () => {
				cancelled = true;
			},
		});
		const result = await runWorkflow(activities, "r6", {
			cancelAfter: () => waitFor(() => names(calls).includes("awaitAgentNode")),
		});
		assert.equal(result.outcome, "failed");
		await waitFor(() => cancelled);
		assert.deepEqual(runStatuses(calls), ["running"]);
	});
});

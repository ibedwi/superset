import { describe, expect, test } from "bun:test";
import type { WorkflowGraph } from "@superset/shared/workflow-graph";
import type { WorkflowRunActivities } from "../../activities/workflowActivities";
import { NodeError } from "../nodeError";
import {
	createMemoryContext,
	MemoryCancellation,
} from "../testing/memoryContext";
import { runGraph } from "./runGraph";

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

function cliNode(id: string) {
	return {
		id,
		type: "cli",
		position: { x: 0, y: 0 },
		config: {
			command: "make",
			target: { hostId: "h1", v2WorkspaceId: "w1" },
			timeoutMinutes: 10,
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
	settleAfterChunks?: number;
	httpFails?: boolean;
	agentThrowsCancellation?: boolean;
	cliChunks?: { status: "running" | "done"; tail: string }[];
}

function setup(script: Script, pollChunkMs = 60_000) {
	const recorded: string[] = [];
	const runStatuses: { status: string; error?: string | null }[] = [];
	const cliOffsets: number[] = [];
	let awaits = 0;
	const cliChunks = [...(script.cliChunks ?? [])];
	const activities: WorkflowRunActivities = {
		async loadWorkflowRun() {
			return {
				graph: script.graph,
				triggerContext: script.triggerContext ?? null,
				title: "test",
			};
		},
		async recordRunStatus(input) {
			runStatuses.push({ status: input.status, error: input.error });
		},
		async recordStep(input) {
			recorded.push(`${input.nodeId}:${input.status}`);
		},
		async dispatchAgentNode(input) {
			return {
				hostId: "h1",
				workspaceId: "w1",
				terminalId: `t-${input.nodeId}`,
			};
		},
		async awaitAgentNode() {
			if (script.agentThrowsCancellation) throw new MemoryCancellation();
			awaits++;
			return awaits > (script.settleAfterChunks ?? 0)
				? { settled: true, state: "idle" }
				: { settled: false };
		},
		async captureAgentOutput() {
			return { json: { ok: true }, text: "done" };
		},
		async execCliNode(input) {
			return { jobId: `job-${input.nodeId}` };
		},
		async pollCliNode(input) {
			cliOffsets.push(input.offset);
			const chunk = cliChunks.shift() ?? { status: "done" as const, tail: "" };
			return {
				status: chunk.status,
				exitCode: 0,
				tail: chunk.tail,
				offset: input.offset + chunk.tail.length,
			};
		},
		async killCliNode() {},
		async callLlmNode() {
			return { text: "answer" };
		},
		async callHttpNode() {
			if (script.httpFails) {
				throw new NodeError({
					message: "HTTP 404 from api.example.com",
					code: "HttpNodeClientError",
					retryable: false,
				});
			}
			return { status: 200, body: "{}", json: {} };
		},
	};
	const ctx = createMemoryContext({ activities, pollChunkMs });
	return { ctx, recorded, runStatuses, cliOffsets };
}

describe("runGraph", () => {
	test("runs a linear graph and records each step", async () => {
		const { ctx, recorded, runStatuses } = setup({
			graph: {
				nodes: [trigger, agentNode("build"), httpNode("notify")],
				edges: [edge("start", "build"), edge("build", "notify")],
			},
		});
		await runGraph({ ctx, runId: "r1" });
		expect(runStatuses.map((s) => s.status)).toEqual(["running", "succeeded"]);
		expect(recorded).toEqual([
			"start:running",
			"start:succeeded",
			"build:running",
			"build:succeeded",
			"notify:running",
			"notify:succeeded",
		]);
	});

	test("gives every call in a run a unique key", async () => {
		const { ctx } = setup({
			graph: {
				nodes: [trigger, agentNode("review")],
				edges: [edge("start", "review")],
			},
			settleAfterChunks: 1,
		});
		await runGraph({ ctx, runId: "r1" });
		const keys = ctx.calls.map((call) => call.options.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys.filter((key) => key.startsWith("review:"))).toEqual([
			"review:record:running",
			"review:dispatch",
			"review:await:0",
			"review:await:1",
			"review:capture",
			"review:record:succeeded",
		]);
	});

	test("runs both branches before the node that joins them", async () => {
		const { ctx, recorded } = setup({
			graph: {
				nodes: [trigger, agentNode("a"), agentNode("b"), httpNode("join")],
				edges: [
					edge("start", "a"),
					edge("start", "b"),
					edge("a", "join"),
					edge("b", "join"),
				],
			},
		});
		await runGraph({ ctx, runId: "r2" });
		const joinStart = recorded.indexOf("join:running");
		expect(recorded.indexOf("a:succeeded")).toBeLessThan(joinStart);
		expect(recorded.indexOf("b:succeeded")).toBeLessThan(joinStart);
		expect(recorded).toContain("join:succeeded");
	});

	test("skips the untaken condition branch and everything behind it", async () => {
		const { ctx, recorded, runStatuses } = setup({
			graph: {
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
			},
			triggerContext: { go: true },
		});
		await runGraph({ ctx, runId: "r3" });
		expect(recorded).toContain("yes:succeeded");
		expect(recorded).toContain("no:skipped");
		expect(recorded).toContain("after-no:skipped");
		expect(
			ctx.calls.filter((c) => c.name === "dispatchAgentNode"),
		).toHaveLength(1);
		expect(runStatuses.map((s) => s.status)).toEqual(["running", "succeeded"]);
	});

	test("fails the run when a node fails", async () => {
		const { ctx, recorded, runStatuses } = setup({
			graph: {
				nodes: [trigger, httpNode("call"), agentNode("never")],
				edges: [edge("start", "call"), edge("call", "never")],
			},
			httpFails: true,
		});
		await runGraph({ ctx, runId: "r4" });
		expect(recorded).toContain("call:failed");
		expect(ctx.calls.some((c) => c.name === "dispatchAgentNode")).toBe(false);
		expect(runStatuses.map((s) => s.status)).toEqual(["running", "failed"]);
		expect(runStatuses[1]?.error).toMatch(/HTTP 404/);
	});

	test("polls an agent in chunks until it settles", async () => {
		const { ctx, runStatuses } = setup(
			{
				graph: {
					nodes: [trigger, agentNode("slow")],
					edges: [edge("start", "slow")],
				},
				settleAfterChunks: 2,
			},
			60_000,
		);
		await runGraph({ ctx, runId: "r5" });
		const awaits = ctx.calls.filter((c) => c.name === "awaitAgentNode");
		expect(awaits).toHaveLength(3);
		expect(awaits.map((c) => c.options.key)).toEqual([
			"slow:await:0",
			"slow:await:1",
			"slow:await:2",
		]);
		expect(awaits[0]?.input).toMatchObject({ budgetMs: 60_000 });
		expect(runStatuses.map((s) => s.status)).toEqual(["running", "succeeded"]);
	});

	test("times out an agent that never settles within its timeout", async () => {
		const { ctx, recorded, runStatuses } = setup(
			{
				graph: {
					nodes: [trigger, agentNode("slow", 2)],
					edges: [edge("start", "slow")],
				},
				settleAfterChunks: 100,
			},
			45_000,
		);
		await runGraph({ ctx, runId: "r6" });
		const budgets = ctx.calls
			.filter((c) => c.name === "awaitAgentNode")
			.map((c) => (c.input as { budgetMs: number }).budgetMs);
		expect(budgets).toEqual([45_000, 45_000, 30_000]);
		expect(recorded).toContain("slow:failed");
		expect(runStatuses.map((s) => s.status)).toEqual(["running", "timed_out"]);
	});

	test("continues a CLI poll from the offset of the last chunk", async () => {
		const { ctx, cliOffsets, runStatuses } = setup({
			graph: {
				nodes: [trigger, cliNode("build")],
				edges: [edge("start", "build")],
			},
			cliChunks: [
				{ status: "running", tail: "abc" },
				{ status: "running", tail: "de" },
				{ status: "done", tail: "f" },
			],
		});
		await runGraph({ ctx, runId: "r7" });
		expect(cliOffsets).toEqual([0, 3, 5]);
		expect(runStatuses.map((s) => s.status)).toEqual(["running", "succeeded"]);
	});

	test("rethrows cancellation and writes no final status", async () => {
		const { ctx, recorded, runStatuses } = setup({
			graph: {
				nodes: [trigger, agentNode("long")],
				edges: [edge("start", "long")],
			},
			agentThrowsCancellation: true,
		});
		await expect(runGraph({ ctx, runId: "r8" })).rejects.toBeInstanceOf(
			MemoryCancellation,
		);
		expect(recorded).not.toContain("long:failed");
		expect(runStatuses.map((s) => s.status)).toEqual(["running"]);
	});
});

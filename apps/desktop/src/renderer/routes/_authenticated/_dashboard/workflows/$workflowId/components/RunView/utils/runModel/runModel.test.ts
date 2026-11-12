import { describe, expect, test } from "bun:test";
import type { WorkflowGraph } from "@superset/shared/workflow-graph";
import { buildRunModel, type RunStep } from "./runModel";

const graph: WorkflowGraph = {
	nodes: [
		{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, config: {} },
		{
			id: "check",
			type: "condition",
			name: "Any PRs open?",
			position: { x: 0, y: 0 },
			config: { expression: { left: { value: 1 }, op: "truthy" } },
		},
		{
			id: "review",
			type: "cli",
			name: "Review",
			position: { x: 0, y: 0 },
			config: { command: "x", target: { hostId: "h" }, timeoutMinutes: 1 },
		},
		{
			id: "nothing",
			type: "cli",
			position: { x: 0, y: 0 },
			config: { command: "y", target: { hostId: "h" }, timeoutMinutes: 1 },
		},
		{
			id: "post",
			type: "cli",
			position: { x: 0, y: 0 },
			config: { command: "z", target: { hostId: "h" }, timeoutMinutes: 1 },
		},
	],
	edges: [
		{ id: "e1", source: "trigger", target: "check" },
		{ id: "e2", source: "check", target: "review", sourceHandle: "true" },
		{ id: "e3", source: "check", target: "nothing", sourceHandle: "false" },
		{ id: "e4", source: "review", target: "post" },
	],
};

const created = Date.UTC(2026, 10, 12, 2, 0, 0);
const at = (ms: number) => new Date(created + ms);

function step(
	nodeId: string,
	status: RunStep["status"],
	startMs: number | null,
	endMs: number | null,
	output: unknown = null,
): RunStep {
	return {
		nodeId,
		nodeType: "cli",
		status,
		input: null,
		output,
		error: null,
		attempt: 1,
		startedAt: startMs === null ? null : at(startMs),
		finishedAt: endMs === null ? null : at(endMs),
	};
}

const liveSteps = [
	step("trigger", "succeeded", 1200, 1250),
	step("check", "succeeded", 1300, 1340, { result: true }),
	step("nothing", "skipped", null, 1340),
	step("review", "running", 1400, null),
];

describe("buildRunModel", () => {
	test("measures times from run creation and grows running steps to now", () => {
		const model = buildRunModel({
			graph,
			run: {
				status: "running",
				createdAt: at(0),
				startedAt: at(1200),
				finishedAt: null,
			},
			steps: liveSteps,
			now: created + 9000,
		});
		expect(model.queuedMs).toBe(1200);
		expect(model.nowMs).toBe(9000);
		expect(model.rowsById.get("review")).toMatchObject({
			startMs: 1400,
			endMs: 9000,
			depEndMs: 1340,
		});
		expect(model.totalMs).toBe(9000);
	});

	test("gives skipped steps a reason and no times", () => {
		const model = buildRunModel({
			graph,
			run: {
				status: "running",
				createdAt: at(0),
				startedAt: at(1200),
				finishedAt: null,
			},
			steps: liveSteps,
			now: created + 9000,
		});
		expect(model.rowsById.get("nothing")).toMatchObject({
			startMs: null,
			endMs: null,
			skip: { kind: "branch", conditionId: "check" },
		});
	});

	test("lists what a pending step waits on", () => {
		const model = buildRunModel({
			graph,
			run: {
				status: "running",
				createdAt: at(0),
				startedAt: at(1200),
				finishedAt: null,
			},
			steps: liveSteps,
			now: created + 9000,
		});
		expect(model.rowsById.get("post")?.waitingOn).toEqual(["review"]);
		expect(model.counts).toMatchObject({
			succeeded: 2,
			running: 1,
			skipped: 1,
			pending: 1,
		});
	});

	test("never puts now before a time the server recorded", () => {
		const model = buildRunModel({
			graph,
			run: {
				status: "running",
				createdAt: at(0),
				startedAt: at(1200),
				finishedAt: null,
			},
			steps: liveSteps,
			now: created + 500,
		});
		expect(model.nowMs).toBe(1400);
	});

	test("finds the failed step of a finished run", () => {
		const model = buildRunModel({
			graph,
			run: {
				status: "failed",
				createdAt: at(0),
				startedAt: at(1200),
				finishedAt: at(5000),
			},
			steps: [...liveSteps.slice(0, 3), step("review", "failed", 1400, 4900)],
			now: created + 60_000,
		});
		expect(model.nowMs).toBeNull();
		expect(model.failedRow?.node.id).toBe("review");
		expect(model.totalMs).toBe(5000);
		expect(model.rows.map((row) => row.node.id)).toEqual([
			"trigger",
			"check",
			"review",
			"nothing",
			"post",
		]);
	});

	test("treats a trigger without a step row as fired once any step ran", () => {
		const model = buildRunModel({
			graph,
			run: {
				status: "running",
				createdAt: at(0),
				startedAt: at(1200),
				finishedAt: null,
			},
			steps: liveSteps.slice(1),
			now: created + 9000,
		});
		expect(model.rowsById.get("trigger")?.status).toBe("succeeded");
	});
});

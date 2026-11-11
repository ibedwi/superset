import { describe, expect, test } from "bun:test";
import type { DraftWorkflowGraph } from "@superset/shared/workflow-graph";
import {
	applyRunSteps,
	createNode,
	fromCanvas,
	nextNodeId,
	toCanvasEdges,
	toCanvasNodes,
} from "./graphMapping";

const graph: DraftWorkflowGraph = {
	nodes: [
		{ id: "start", type: "trigger", position: { x: 0, y: 0 }, config: {} },
		{
			id: "agent",
			type: "agent",
			position: { x: 200, y: 0 },
			config: { agent: "claude", prompt: "hi", timeoutMinutes: 120 },
		},
		{
			id: "gate",
			type: "condition",
			position: { x: 400, y: 0 },
			config: {},
		},
	],
	edges: [
		{ id: "e1", source: "start", target: "agent" },
		{ id: "e2", source: "gate", target: "agent", sourceHandle: "true" },
	],
};

describe("graph mapping", () => {
	test("round-trips a graph through canvas state", () => {
		const nodes = toCanvasNodes(graph);
		const edges = toCanvasEdges(graph);
		const back = fromCanvas(nodes, edges);
		expect(back.nodes).toEqual(graph.nodes);
		expect(back.edges).toEqual(graph.edges);
	});

	test("canvas position wins over the stored one", () => {
		const nodes = toCanvasNodes(graph);
		nodes[0]!.position = { x: 50, y: 60 };
		const back = fromCanvas(nodes, toCanvasEdges(graph));
		expect(back.nodes[0]!.position).toEqual({ x: 50, y: 60 });
	});

	test("drops foreign sourceHandles", () => {
		const edges = toCanvasEdges(graph);
		edges[0]!.sourceHandle = "out";
		const back = fromCanvas(toCanvasNodes(graph), edges);
		expect(back.edges[0]!.sourceHandle).toBeUndefined();
		expect(back.edges[1]!.sourceHandle).toBe("true");
	});

	test("nextNodeId picks the bare type first, then numbers", () => {
		expect(nextNodeId("llm", ["start"])).toBe("llm");
		expect(nextNodeId("agent", ["agent", "agent-2"])).toBe("agent-3");
	});

	test("createNode produces a schema-shaped draft node", () => {
		const node = createNode("http", ["start"], { x: 1, y: 2 });
		expect(node.id).toBe("http");
		expect(node.data.wf).toMatchObject({
			id: "http",
			type: "http",
			position: { x: 1, y: 2 },
		});
	});
});

describe("applyRunSteps", () => {
	const nodes = toCanvasNodes(graph);
	const edges = toCanvasEdges(graph);

	test("maps step statuses onto nodes, pending when unreached", () => {
		const { nodes: decorated } = applyRunSteps(nodes, edges, [
			{ nodeId: "agent", status: "running" },
		]);
		const byId = new Map(decorated.map((node) => [node.id, node]));
		expect(byId.get("agent")!.data.stepStatus).toBe("running");
		expect(byId.get("gate")!.data.stepStatus).toBe("pending");
		// The trigger has no step row; any step existing means it fired.
		expect(byId.get("start")!.data.stepStatus).toBe("succeeded");
		expect(decorated.every((node) => node.draggable === false)).toBe(true);
	});

	test("trigger stays pending before any step exists", () => {
		const { nodes: decorated } = applyRunSteps(nodes, edges, []);
		const start = decorated.find((node) => node.id === "start")!;
		expect(start.data.stepStatus).toBe("pending");
	});

	test("animates the edge into a running node and dims skipped sides", () => {
		const { edges: decorated } = applyRunSteps(nodes, edges, [
			{ nodeId: "agent", status: "running" },
			{ nodeId: "gate", status: "skipped" },
		]);
		const byId = new Map(decorated.map((edge) => [edge.id, edge]));
		expect(byId.get("e1")!.animated).toBe(true);
		expect(byId.get("e2")!.style).toEqual({ opacity: 0.3 });
	});
});

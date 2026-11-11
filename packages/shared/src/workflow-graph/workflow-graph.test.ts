import { describe, expect, test } from "bun:test";
import { evaluateCondition } from "./conditions";
import { referencedNodeIds, renderTemplate, resolveReference, type RunContext } from "./references";
import {
	draftWorkflowGraphSchema,
	workflowGraphSchema,
	type WorkflowGraph,
} from "./schema";
import { subtreeBehindEdges, topologicalOrder, validateGraph } from "./topo";

const trigger = { id: "start", type: "trigger", position: { x: 0, y: 0 }, config: {} } as const;

function agentNode(id: string) {
	return {
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		config: {
			agent: "claude",
			prompt: "do the thing",
			target: { hostId: "cloud" },
			timeoutMinutes: 120,
		},
	} as const;
}

function conditionNode(id: string) {
	return {
		id,
		type: "condition",
		position: { x: 0, y: 0 },
		config: {
			expression: { left: { ref: "trigger.ok" }, op: "truthy" },
		},
	} as const;
}

function edge(source: string, target: string, sourceHandle?: "true" | "false") {
	return { id: `${source}->${target}${sourceHandle ? `:${sourceHandle}` : ""}`, source, target, sourceHandle };
}

function graph(nodes: unknown[], edges: unknown[]): WorkflowGraph {
	return workflowGraphSchema.parse({ nodes, edges });
}

describe("workflowGraphSchema", () => {
	test("accepts a strict linear graph", () => {
		const parsed = graph([trigger, agentNode("build")], [edge("start", "build")]);
		expect(parsed.nodes).toHaveLength(2);
	});

	test("rejects an agent node without a prompt", () => {
		const result = workflowGraphSchema.safeParse({
			nodes: [trigger, { ...agentNode("build"), config: { ...agentNode("build").config, prompt: "" } }],
			edges: [edge("start", "build")],
		});
		expect(result.success).toBe(false);
	});

	test("draft schema holds the same half-configured node", () => {
		const result = draftWorkflowGraphSchema.safeParse({
			nodes: [trigger, { id: "build", type: "agent", position: { x: 1, y: 1 }, config: {} }],
			edges: [edge("start", "build")],
		});
		expect(result.success).toBe(true);
	});

	test("rejects uppercase node ids", () => {
		const result = workflowGraphSchema.safeParse({
			nodes: [{ ...trigger, id: "Start" }],
			edges: [],
		});
		expect(result.success).toBe(false);
	});
});

describe("validateGraph", () => {
	test("accepts a valid branch graph", () => {
		const g = graph(
			[trigger, conditionNode("gate"), agentNode("yes"), agentNode("no")],
			[
				edge("start", "gate"),
				edge("gate", "yes", "true"),
				edge("gate", "no", "false"),
			],
		);
		expect(validateGraph(g)).toEqual([]);
	});

	test("flags a missing trigger", () => {
		const g = graph([agentNode("a")], []);
		expect(validateGraph(g)).toContainEqual({ kind: "no_trigger" });
	});

	test("flags a cycle", () => {
		const g = graph(
			[trigger, agentNode("a"), agentNode("b")],
			[edge("start", "a"), edge("a", "b"), edge("b", "a")],
		);
		expect(validateGraph(g).some((p) => p.kind === "cycle")).toBe(true);
	});

	test("flags condition edges without handles", () => {
		const g = graph(
			[trigger, conditionNode("gate"), agentNode("a")],
			[edge("start", "gate"), edge("gate", "a")],
		);
		expect(validateGraph(g).some((p) => p.kind === "missing_condition_handle")).toBe(true);
	});

	test("flags unreachable nodes", () => {
		const g = graph([trigger, agentNode("island")], []);
		expect(validateGraph(g)).toContainEqual({ kind: "unreachable", nodeIds: ["island"] });
	});
});

describe("topologicalOrder", () => {
	test("is deterministic and respects edges", () => {
		const g = graph(
			[trigger, agentNode("b"), agentNode("a"), agentNode("z")],
			[edge("start", "b"), edge("start", "a"), edge("a", "z"), edge("b", "z")],
		);
		expect(topologicalOrder(g)).toEqual(["start", "a", "b", "z"]);
	});

	test("returns null on a cycle", () => {
		const g = graph(
			[trigger, agentNode("a"), agentNode("b")],
			[edge("start", "a"), edge("a", "b"), edge("b", "a")],
		);
		expect(topologicalOrder(g)).toBeNull();
	});
});

describe("subtreeBehindEdges", () => {
	test("finds nodes only reachable through the dropped branch", () => {
		const g = graph(
			[trigger, conditionNode("gate"), agentNode("yes"), agentNode("no"), agentNode("after-no")],
			[
				edge("start", "gate"),
				edge("gate", "yes", "true"),
				edge("gate", "no", "false"),
				edge("no", "after-no"),
			],
		);
		const dropped = new Set(["gate->no:false"]);
		expect(subtreeBehindEdges(g, dropped).sort()).toEqual(["after-no", "no"]);
	});
});

describe("references", () => {
	const context: RunContext = {
		runId: "run-1",
		trigger: { pr: { number: 42, labels: ["bug", "p1"] } },
		nodes: {
			review: { output: { json: { approved: true, score: 8 }, text: "looks good" } },
		},
	};

	test("resolves node outputs, trigger paths, and run id", () => {
		expect(resolveReference(context, "nodes.review.output.json.score")).toBe(8);
		expect(resolveReference(context, "trigger.pr.labels.1")).toBe("p1");
		expect(resolveReference(context, "run.id")).toBe("run-1");
	});

	test("missing paths resolve to undefined and render empty", () => {
		expect(resolveReference(context, "nodes.review.output.json.missing")).toBeUndefined();
		expect(renderTemplate(context, "a={{nodes.review.output.json.missing}}!")).toBe("a=!");
	});

	test("renders strings bare and objects as JSON", () => {
		expect(renderTemplate(context, "{{nodes.review.output.text}}")).toBe("looks good");
		expect(renderTemplate(context, "{{nodes.review.output.json}}")).toBe(
			'{"approved":true,"score":8}',
		);
	});

	test("does not walk prototype properties", () => {
		expect(resolveReference(context, "nodes.review.output.constructor")).toBeUndefined();
		expect(resolveReference(context, "trigger.__proto__")).toBeUndefined();
	});

	test("collects referenced node ids", () => {
		expect(
			referencedNodeIds("{{nodes.review.output.text}} and {{nodes.build.output.json.ok}} {{run.id}}"),
		).toEqual(["review", "build"]);
	});
});

describe("evaluateCondition", () => {
	const context: RunContext = {
		runId: "run-1",
		trigger: { count: 3, label: "bug" },
		nodes: { check: { output: { json: { passed: true }, text: "7" } } },
	};

	test("leaf operators", () => {
		expect(
			evaluateCondition(context, { left: { ref: "trigger.label" }, op: "eq", right: { value: "bug" } }),
		).toBe(true);
		expect(
			evaluateCondition(context, { left: { ref: "trigger.count" }, op: "gt", right: { value: 2 } }),
		).toBe(true);
		expect(
			evaluateCondition(context, { left: { ref: "nodes.check.output.text" }, op: "gte", right: { value: 7 } }),
		).toBe(true);
		expect(
			evaluateCondition(context, { left: { ref: "trigger.missing" }, op: "exists" }),
		).toBe(false);
		expect(
			evaluateCondition(context, { left: { ref: "nodes.check.output.json.passed" }, op: "truthy" }),
		).toBe(true);
		expect(
			evaluateCondition(context, { left: { value: "hello world" }, op: "contains", right: { value: "world" } }),
		).toBe(true);
	});

	test("string/number comparisons cross types via canonical text", () => {
		expect(
			evaluateCondition(context, { left: { ref: "trigger.count" }, op: "eq", right: { value: "3" } }),
		).toBe(true);
	});

	test("all / any combinators", () => {
		expect(
			evaluateCondition(context, {
				all: [
					{ left: { ref: "trigger.count" }, op: "gt", right: { value: 1 } },
					{ any: [
						{ left: { ref: "trigger.label" }, op: "eq", right: { value: "feature" } },
						{ left: { ref: "trigger.label" }, op: "eq", right: { value: "bug" } },
					] },
				],
			}),
		).toBe(true);
	});

	test("non-numeric comparisons are false, not errors", () => {
		expect(
			evaluateCondition(context, { left: { ref: "trigger.label" }, op: "gt", right: { value: 1 } }),
		).toBe(false);
	});
});

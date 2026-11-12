import { describe, expect, test } from "bun:test";
import { LAYOUT_RANK_GAP } from "@superset/shared/workflow-graph";
import { TRPCError } from "@trpc/server";
import {
	type AskGraphModel,
	checkGeneratedGraph,
	type GraphModelMessage,
	generateWorkflowGraph,
} from "./generate";

const goodReply = {
	name: "Morning PR digest",
	nodes: [
		{ id: "trigger", type: "trigger", name: "Every morning", config: {} },
		{
			id: "fetch_prs",
			type: "http",
			config: { method: "GET", url: "https://api.github.com/repos/o/r/pulls" },
		},
		{
			id: "summarize",
			type: "llm",
			config: {
				model: "not-a-model",
				effort: "max",
				prompt: "Summarize: {{nodes.fetch_prs.output.body}}",
			},
		},
		{
			id: "post",
			type: "http",
			config: {
				method: "POST",
				url: "",
				body: "{{nodes.summarize.output.text}}",
			},
		},
	],
	edges: [
		{ id: "e1", source: "trigger", target: "fetch_prs" },
		{ id: "e2", source: "fetch_prs", target: "summarize" },
		{ id: "e3", source: "summarize", target: "post" },
	],
};

function scriptedModel(replies: string[]) {
	const calls: GraphModelMessage[][] = [];
	const ask: AskGraphModel = async (messages) => {
		calls.push([...messages]);
		return replies[calls.length - 1] ?? "";
	};
	return { ask, calls };
}

describe("checkGeneratedGraph", () => {
	test("accepts a valid reply, lays it out top to bottom, and fixes the model id", () => {
		const result = checkGeneratedGraph(goodReply);
		if (!result.ok) throw new Error(result.problems.join("\n"));
		const { graph, name } = result.value;
		expect(name).toBe("Morning PR digest");
		expect(graph.nodes.map((node) => node.position)).toEqual([
			{ x: 0, y: 0 },
			{ x: 0, y: LAYOUT_RANK_GAP },
			{ x: 0, y: 2 * LAYOUT_RANK_GAP },
			{ x: 0, y: 3 * LAYOUT_RANK_GAP },
		]);
		const llm = graph.nodes.find((node) => node.id === "summarize");
		expect(llm?.type === "llm" && llm.config.model).toBe("claude-sonnet-5-5");
	});

	test("rejects schema violations with their paths", () => {
		const result = checkGeneratedGraph({
			...goodReply,
			nodes: [...goodReply.nodes, { id: "Bad Id", type: "llm", config: {} }],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.problems[0]).toContain("nodes.4.id");
	});

	test("rejects structural problems and references to nodes that run later", () => {
		const result = checkGeneratedGraph({
			...goodReply,
			nodes: goodReply.nodes.map((node) =>
				node.id === "fetch_prs"
					? {
							...node,
							config: { ...node.config, url: "{{nodes.post.output.body}}" },
						}
					: node,
			),
			edges: [
				...goodReply.edges,
				{ id: "e4", source: "post", target: "trigger" },
			],
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.problems.join("\n")).toContain("edge_into_trigger");
		}

		const late = checkGeneratedGraph({
			...goodReply,
			nodes: goodReply.nodes.map((node) =>
				node.id === "fetch_prs"
					? {
							...node,
							config: { ...node.config, url: "{{nodes.post.output.body}}" },
						}
					: node,
			),
		});
		expect(late.ok).toBe(false);
		if (!late.ok) expect(late.problems[0]).toContain("does not run before it");
	});

	test("keeps only host targets the current graph already uses", () => {
		const reply = {
			nodes: [
				{ id: "trigger", type: "trigger", config: {} },
				{
					id: "run",
					type: "cli",
					config: { command: "ls", target: { hostId: "host-1" } },
				},
			],
			edges: [{ id: "e1", source: "trigger", target: "run" }],
		};
		const targetOf = (result: ReturnType<typeof checkGeneratedGraph>) => {
			const node = result.ok ? result.value.graph.nodes[1] : undefined;
			return node?.type === "cli" ? node.config.target : undefined;
		};

		expect(targetOf(checkGeneratedGraph(reply))).toBeUndefined();

		const fresh = checkGeneratedGraph(reply);
		if (!fresh.ok) throw new Error("expected a valid graph");
		const current = {
			...fresh.value.graph,
			nodes: fresh.value.graph.nodes.map((node) =>
				node.type === "cli"
					? {
							...node,
							config: { ...node.config, target: { hostId: "host-1" } },
						}
					: node,
			),
		};
		expect(targetOf(checkGeneratedGraph(reply, current))?.hostId).toBe(
			"host-1",
		);
	});
});

describe("generateWorkflowGraph", () => {
	test("feeds problems back and returns the corrected graph", async () => {
		const model = scriptedModel([
			"not json at all",
			`Here you go:\n\`\`\`json\n${JSON.stringify(goodReply)}\n\`\`\``,
		]);
		const result = await generateWorkflowGraph({
			description: "PR digest",
			ask: model.ask,
		});
		expect(result.graph.nodes).toHaveLength(4);
		expect(model.calls).toHaveLength(2);
		expect(model.calls[1]?.at(-1)?.content).toContain("not valid");
	});

	test("gives up with UNPROCESSABLE_CONTENT after the last attempt", async () => {
		const model = scriptedModel(["{}", "{}"]);
		const error = await generateWorkflowGraph({
			description: "anything",
			ask: model.ask,
			maxAttempts: 2,
		}).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TRPCError);
		expect((error as TRPCError).code).toBe("UNPROCESSABLE_CONTENT");
		expect(model.calls).toHaveLength(2);
	});

	test("sends the current graph without positions when extending", async () => {
		const model = scriptedModel([JSON.stringify(goodReply)]);
		await generateWorkflowGraph({
			description: "add a step",
			current: {
				nodes: [
					{
						id: "trigger",
						type: "trigger",
						position: { x: 5, y: 5 },
						config: {},
					},
				],
				edges: [],
			},
			ask: model.ask,
		});
		const prompt = model.calls[0]?.[0]?.content ?? "";
		expect(prompt).toContain('"id":"trigger"');
		expect(prompt).not.toContain("position");
	});
});

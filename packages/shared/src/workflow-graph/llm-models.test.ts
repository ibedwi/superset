import { expect, test } from "bun:test";
import { getWorkflowLlmEfforts, workflowLlmEffortConfig } from "./llm-models";
import { draftWorkflowGraphSchema, workflowGraphSchema } from "./schema";

test("offers effort levels supported by each LLM model", () => {
	expect(getWorkflowLlmEfforts("claude-opus-4-6")).toEqual([
		"low",
		"medium",
		"high",
		"max",
	]);
	expect(getWorkflowLlmEfforts("claude-opus-4-5-20251101")).toEqual([
		"low",
		"medium",
		"high",
	]);
	expect(getWorkflowLlmEfforts("claude-haiku-4-5")).toEqual([]);
	expect(getWorkflowLlmEfforts("unknown")).toEqual([]);
});

test("adds the Anthropic effort setting only for supported combinations", () => {
	expect(workflowLlmEffortConfig("claude-sonnet-4-6", "high")).toEqual({
		output_config: { effort: "high" },
	});
	expect(workflowLlmEffortConfig("claude-sonnet-4-6")).toEqual({});
	expect(workflowLlmEffortConfig("claude-opus-4-5", "max")).toEqual({});
	expect(workflowLlmEffortConfig("claude-haiku-4-5", "high")).toEqual({});
});

test("preserves LLM launch settings and legacy models in saved and draft graphs", () => {
	for (const config of [
		{
			prompt: "Summarize",
			model: "claude-opus-4-6",
			effort: "max" as const,
			maxTokens: 4096,
		},
		{ prompt: "Summarize", model: "legacy-model", maxTokens: 4096 },
	]) {
		const graph = {
			nodes: [
				{ id: "summarize", type: "llm", position: { x: 0, y: 0 }, config },
			],
			edges: [],
		};
		expect(draftWorkflowGraphSchema.parse(graph).nodes[0]?.config).toEqual(
			config,
		);
		expect(workflowGraphSchema.parse(graph).nodes[0]?.config).toEqual(config);
	}
});

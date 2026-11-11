import { getAgentModelSupport } from "../agent-models";

export const workflowLlmEffortValues = [
	"low",
	"medium",
	"high",
	"max",
] as const;
export type WorkflowLlmEffort = (typeof workflowLlmEffortValues)[number];

export const WORKFLOW_LLM_MODELS = (
	getAgentModelSupport("claude")?.models ?? []
).filter((model) => model.id.startsWith("claude-"));

const EFFORT_MODELS = new Set([
	"claude-fable-5-2",
	"claude-fable-5-1",
	"claude-fable-5",
	"claude-opus-5-5",
	"claude-opus-5",
	"claude-opus-4-8",
	"claude-opus-4-7",
	"claude-opus-4-6",
	"claude-opus-4-5",
	"claude-sonnet-5-5",
	"claude-sonnet-5",
	"claude-sonnet-4-6",
]);

export function getWorkflowLlmEfforts(model: string): WorkflowLlmEffort[] {
	const modelId = model.replace(/-\d{8}$/, "");
	if (!EFFORT_MODELS.has(modelId)) return [];
	return workflowLlmEffortValues.filter(
		(effort) => effort !== "max" || modelId !== "claude-opus-4-5",
	);
}

export function workflowLlmEffortConfig(
	model: string,
	effort?: WorkflowLlmEffort,
) {
	return effort && getWorkflowLlmEfforts(model).includes(effort)
		? { output_config: { effort } }
		: {};
}

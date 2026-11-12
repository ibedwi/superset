import { formatNumber } from "@superset/i18n/format";
import {
	type DraftWorkflowNode,
	WORKFLOW_LLM_MODELS,
	type WorkflowConditionOp,
	type WorkflowLeafCondition,
	type WorkflowLlmEffort,
} from "@superset/shared/workflow-graph";

type ConditionConfig = Extract<
	DraftWorkflowNode,
	{ type: "condition" }
>["config"];
type HttpConfig = Extract<DraftWorkflowNode, { type: "http" }>["config"];

export const UNARY_CONDITION_OPS: ReadonlySet<WorkflowConditionOp> = new Set([
	"exists",
	"truthy",
]);

export const NUMERIC_CONDITION_OPS: ReadonlySet<WorkflowConditionOp> = new Set([
	"gt",
	"gte",
	"lt",
	"lte",
]);

export const CONDITION_OP_LABELS: Record<WorkflowConditionOp, string> = {
	eq: "Is equal to",
	neq: "Is not equal to",
	contains: "Contains",
	gt: "Is greater than",
	gte: "Is at least",
	lt: "Is less than",
	lte: "Is at most",
	exists: "Exists",
	truthy: "Is truthy",
};

const CONDITION_PREDICATES: Record<
	WorkflowConditionOp,
	(value: string) => string
> = {
	eq: (value) => `is equal to ${value}`,
	neq: (value) => `is not equal to ${value}`,
	contains: (value) => `contains ${value}`,
	gt: (value) => `is greater than ${value}`,
	gte: (value) => `is at least ${value}`,
	lt: (value) => `is less than ${value}`,
	lte: (value) => `is at most ${value}`,
	exists: () => "exists",
	truthy: () => "is truthy",
};

export const LLM_EFFORT_LABELS: Record<WorkflowLlmEffort, string> = {
	low: "Low",
	medium: "Medium",
	high: "High",
	max: "Max",
};

/** v1 edits a single comparison; all/any groups are not editable yet. */
export function conditionLeaf(
	config: ConditionConfig,
): WorkflowLeafCondition | null {
	const expression = config.expression;
	if (!expression || "all" in expression || "any" in expression) return null;
	return expression;
}

export function refNodeId(ref: string): string | null {
	const match = /^nodes\.([^.]+)/.exec(ref);
	return match?.[1] ?? null;
}

function humanizeSegment(segment: string): string {
	return segment.replace(/[_-]+/g, " ").trim();
}

/** `nodes.fetch-repo.output.json.stars` → "Fetch repo · stars". */
export function describeRef(
	ref: string,
	nodeName: (nodeId: string) => string | undefined,
): string {
	if (ref === "run.id") return "Run ID";
	const segments = ref.split(".").filter(Boolean);
	const last = segments.at(-1);
	if (segments[0] === "trigger") {
		const trigger = "Trigger data";
		return segments.length > 1 && last
			? `${trigger} · ${humanizeSegment(last)}`
			: trigger;
	}
	const nodeId = refNodeId(ref);
	if (!nodeId) return ref;
	const name = nodeName(nodeId) ?? nodeId;
	const path = segments.slice(segments[2] === "output" ? 3 : 2);
	const field = path.at(-1);
	return field ? `${name} · ${humanizeSegment(field)}` : name;
}

function operandText(operand: WorkflowLeafCondition["right"]): string {
	if (!operand) return "";
	if ("ref" in operand) return operand.ref;
	const value = operand.value;
	if (typeof value === "number") return formatNumber(value);
	if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
		return formatNumber(Number(value));
	}
	return String(value ?? "");
}

export function conditionPredicate(leaf: WorkflowLeafCondition): string {
	return CONDITION_PREDICATES[leaf.op](operandText(leaf.right));
}

export function llmModelLabel(model: string): string {
	return (
		WORKFLOW_LLM_MODELS.find((option) => option.id === model)?.label ?? model
	);
}

export function httpEndpointParts(url: string): {
	host: string;
	path: string;
} | null {
	try {
		const parsed = new URL(url);
		return {
			host: parsed.host,
			path: `${parsed.pathname}${parsed.search}` || "/",
		};
	} catch {
		return null;
	}
}

export function httpSummary(config: HttpConfig): string {
	const headerCount = Object.keys(config.headers ?? {}).length;
	const headers = `${headerCount} ${headerCount === 1 ? "header" : "headers"}`;
	const body = config.body ? "Raw body" : "No body";
	const timeout = `${config.timeoutSeconds ?? 30}s timeout`;
	return [headers, body, timeout].join(" · ");
}

export function nodeDisplayName(node: { id: string; name?: string }): string {
	return node.name?.trim() || node.id;
}

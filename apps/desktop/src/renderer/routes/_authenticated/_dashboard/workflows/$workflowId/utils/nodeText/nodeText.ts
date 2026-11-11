import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
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

export const CONDITION_OP_LABELS: Record<
	WorkflowConditionOp,
	MessageDescriptor
> = {
	eq: msg({ message: "Is equal to" }),
	neq: msg({ message: "Is not equal to" }),
	contains: msg({ message: "Contains" }),
	gt: msg({ message: "Is greater than" }),
	gte: msg({ message: "Is at least" }),
	lt: msg({ message: "Is less than" }),
	lte: msg({ message: "Is at most" }),
	exists: msg({ message: "Exists" }),
	truthy: msg({ message: "Is truthy" }),
};

const CONDITION_PREDICATES: Record<WorkflowConditionOp, MessageDescriptor> = {
	eq: msg({ message: "is equal to {value}" }),
	neq: msg({ message: "is not equal to {value}" }),
	contains: msg({ message: "contains {value}" }),
	gt: msg({ message: "is greater than {value}" }),
	gte: msg({ message: "is at least {value}" }),
	lt: msg({ message: "is less than {value}" }),
	lte: msg({ message: "is at most {value}" }),
	exists: msg({ message: "exists" }),
	truthy: msg({ message: "is truthy" }),
};

export const LLM_EFFORT_LABELS: Record<WorkflowLlmEffort, MessageDescriptor> = {
	low: msg({ message: "Low" }),
	medium: msg({ message: "Medium" }),
	high: msg({ message: "High" }),
	max: msg({ message: "Max" }),
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
	if (ref === "run.id") return i18n._(msg({ message: "Run ID" }));
	const segments = ref.split(".").filter(Boolean);
	const last = segments.at(-1);
	if (segments[0] === "trigger") {
		const trigger = i18n._(msg({ message: "Trigger data" }));
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
	return i18n._({
		...CONDITION_PREDICATES[leaf.op],
		values: { value: operandText(leaf.right) },
	});
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
	const headers = i18n._({
		...msg({
			message: "{count, plural, one {# header} other {# headers}}",
		}),
		values: { count: headerCount },
	});
	const body = config.body
		? i18n._(msg({ message: "Raw body" }))
		: i18n._(msg({ message: "No body" }));
	const seconds = config.timeoutSeconds ?? 30;
	const timeout = i18n._({
		...msg({ message: "{seconds}s timeout" }),
		values: { seconds },
	});
	return [headers, body, timeout].join(" · ");
}

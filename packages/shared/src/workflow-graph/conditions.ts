import { type RunContext, resolveReference } from "./references";
import type { WorkflowCondition, WorkflowConditionOperand } from "./schema";

/**
 * Pure condition evaluation. Runs inside the Temporal workflow, so it must be
 * deterministic and total: an unresolvable reference evaluates as undefined
 * rather than throwing.
 */

function operandValue(
	context: RunContext,
	operand: WorkflowConditionOperand,
): unknown {
	if ("ref" in operand) return resolveReference(context, operand.ref);
	return operand.value;
}

function compareNumbers(
	left: unknown,
	right: unknown,
	test: (a: number, b: number) => boolean,
) {
	const a = typeof left === "number" ? left : Number(left);
	const b = typeof right === "number" ? right : Number(right);
	if (Number.isNaN(a) || Number.isNaN(b)) return false;
	return test(a, b);
}

function looseEquals(left: unknown, right: unknown): boolean {
	if (typeof left === typeof right) return left === right;
	// String/number/boolean comparisons across types compare canonical text, so
	// {{...}} output (always a string) can be tested against literal numbers.
	return String(left) === String(right);
}

export function evaluateCondition(
	context: RunContext,
	condition: WorkflowCondition,
): boolean {
	if ("all" in condition)
		return condition.all.every((c) => evaluateCondition(context, c));
	if ("any" in condition)
		return condition.any.some((c) => evaluateCondition(context, c));

	const left = operandValue(context, condition.left);
	const right =
		condition.right === undefined
			? undefined
			: operandValue(context, condition.right);

	switch (condition.op) {
		case "exists":
			return left !== undefined && left !== null;
		case "truthy":
			return Boolean(left);
		case "eq":
			return looseEquals(left, right);
		case "neq":
			return !looseEquals(left, right);
		case "contains":
			if (typeof left === "string") return left.includes(String(right ?? ""));
			if (Array.isArray(left))
				return left.some((item) => looseEquals(item, right));
			return false;
		case "gt":
			return compareNumbers(left, right, (a, b) => a > b);
		case "gte":
			return compareNumbers(left, right, (a, b) => a >= b);
		case "lt":
			return compareNumbers(left, right, (a, b) => a < b);
		case "lte":
			return compareNumbers(left, right, (a, b) => a <= b);
	}
}

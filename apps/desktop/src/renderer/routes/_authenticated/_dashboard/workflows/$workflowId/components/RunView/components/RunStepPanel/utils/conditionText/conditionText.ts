import type { WorkflowCondition } from "@superset/shared/workflow-graph";
import {
	conditionPredicate,
	describeRef,
} from "../../../../../../utils/nodeText";

/** `nodes.fetch.output.json.length` gt 0 → "Fetch · length is greater than 0". */
export function conditionText(
	expression: WorkflowCondition | undefined,
	nameOf: (nodeId: string) => string,
): string | null {
	if (!expression) return null;
	if ("all" in expression) {
		return `All of ${expression.all.length} checks pass`;
	}
	if ("any" in expression) {
		return `Any of ${expression.any.length} checks pass`;
	}
	const left =
		"ref" in expression.left
			? describeRef(expression.left.ref, nameOf)
			: String(expression.left.value);
	return `${left} ${conditionPredicate(expression)}`;
}

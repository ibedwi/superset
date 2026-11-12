import { formatList } from "@superset/i18n/format";
import type {
	WorkflowEdge,
	WorkflowNode,
} from "@superset/shared/workflow-graph";
import { cn } from "@superset/ui/utils";
import type { RunModel, RunStep } from "../../../../utils/runModel";
import { BRANCH_LABELS, conditionResult } from "../../../../utils/skipReason";
import { DetailSection } from "../../../DetailSection";
import { conditionText } from "../../utils/conditionText";

interface ConditionStepDetailsProps {
	node: Extract<WorkflowNode, { type: "condition" }>;
	step: RunStep;
	model: RunModel;
	edges: WorkflowEdge[];
}

export function ConditionStepDetails({
	node,
	step,
	model,
	edges,
}: ConditionStepDetailsProps) {
	const text = conditionText(node.config.expression, model.nameOf);
	const result = conditionResult(step.output);
	const outgoing = edges.filter((edge) => edge.source === node.id);
	const taken = outgoing
		.filter((edge) => edge.sourceHandle === String(result))
		.map((edge) => model.nameOf(edge.target));
	const skipped = outgoing
		.filter(
			(edge) =>
				edge.sourceHandle !== String(result) &&
				model.rowsById.get(edge.target)?.status === "skipped",
		)
		.map((edge) => model.nameOf(edge.target));

	return (
		<>
			{text && <DetailSection label="Condition">{text}</DetailSection>}
			{result !== null && (
				<>
					<div className="flex items-center gap-2 text-xs">
						<span
							className={cn(
								"size-2 rounded-full",
								result ? "bg-emerald-500" : "bg-stone-400",
							)}
						/>
						<span className="font-semibold">
							Result: {BRANCH_LABELS[String(result) as "true" | "false"]}
						</span>
					</div>
					<p className="text-xs text-muted-foreground">
						{taken.length > 0
							? `Took the ${BRANCH_LABELS[String(result) as "true" | "false"]} branch to ${formatList(taken)}.`
							: `The ${BRANCH_LABELS[String(result) as "true" | "false"]} branch leads to no step.`}
						{skipped.length > 0 &&
							` ${formatList(skipped)} ${skipped.length === 1 ? "was" : "were"} skipped.`}
					</p>
				</>
			)}
		</>
	);
}

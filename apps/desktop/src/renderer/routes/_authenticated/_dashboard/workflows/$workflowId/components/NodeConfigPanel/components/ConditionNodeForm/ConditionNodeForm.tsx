import { Trans, useLingui } from "@lingui/react/macro";
import type {
	DraftWorkflowNode,
	WorkflowLeafCondition,
} from "@superset/shared/workflow-graph";
import { workflowConditionLeafOps } from "@superset/shared/workflow-graph";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";

type ConditionConfig = Extract<
	DraftWorkflowNode,
	{ type: "condition" }
>["config"];

// TODO(workflows): all/any groups — v1 edits a single leaf comparison.
function asLeaf(config: ConditionConfig): WorkflowLeafCondition | null {
	const expression = config.expression;
	if (!expression || "all" in expression || "any" in expression) return null;
	return expression;
}

const OPS_WITHOUT_RIGHT = new Set(["exists", "truthy"]);

interface ConditionNodeFormProps {
	config: ConditionConfig;
	onChange: (config: ConditionConfig) => void;
	disabled: boolean;
}

export function ConditionNodeForm({
	config,
	onChange,
	disabled,
}: ConditionNodeFormProps) {
	const { t } = useLingui();
	const leaf = asLeaf(config) ?? {
		left: { ref: "" },
		op: "truthy" as const,
	};
	const leftRef = "ref" in leaf.left ? leaf.left.ref : "";
	const rightValue =
		leaf.right && "value" in leaf.right ? String(leaf.right.value ?? "") : "";

	const update = (next: Partial<WorkflowLeafCondition>) =>
		onChange({ expression: { ...leaf, ...next } });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Value to test</Trans>
				</Label>
				<Input
					value={leftRef}
					onChange={(event) => update({ left: { ref: event.target.value } })}
					placeholder="nodes.agent.output.text"
					disabled={disabled}
					className="font-mono text-xs"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Operator</Trans>
				</Label>
				<Select
					value={leaf.op}
					onValueChange={(op) =>
						update({ op: op as WorkflowLeafCondition["op"] })
					}
					disabled={disabled}
				>
					<SelectTrigger size="sm" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{workflowConditionLeafOps.map((op) => (
							<SelectItem key={op} value={op}>
								{op}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{!OPS_WITHOUT_RIGHT.has(leaf.op) && (
				<div className="flex flex-col gap-1.5">
					<Label>
						<Trans>Compare to</Trans>
					</Label>
					<Input
						value={rightValue}
						onChange={(event) =>
							update({ right: { value: event.target.value } })
						}
						placeholder={t({ message: "Value" })}
						disabled={disabled}
						className="font-mono text-xs"
					/>
				</div>
			)}

			<p className="text-xs text-muted-foreground">
				<Trans>
					The yes branch runs when this is true, the no branch otherwise.
				</Trans>
			</p>
		</div>
	);
}

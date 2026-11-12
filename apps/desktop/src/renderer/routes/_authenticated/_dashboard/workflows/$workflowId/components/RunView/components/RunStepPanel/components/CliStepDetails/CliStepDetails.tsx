import type { WorkflowNode } from "@superset/shared/workflow-graph";
import { useHostLabel } from "../../../../../../hooks/useHostLabel";
import type { RunStep } from "../../../../utils/runModel";
import { DetailSection } from "../../../DetailSection";
import { KeyValueList } from "../../../KeyValueList";
import { numberField, stringField } from "../../utils/stepData";
import { CopyButton } from "../CopyButton";

interface CliStepDetailsProps {
	node: Extract<WorkflowNode, { type: "cli" }>;
	step: RunStep;
}

export function CliStepDetails({ node, step }: CliStepDetailsProps) {
	const host = useHostLabel(node.config.target.hostId);
	const command = stringField(step.input, "command") ?? node.config.command;
	const exitCode = numberField(step.output, "exitCode");
	const output = stringField(step.output, "text");
	return (
		<>
			<DetailSection
				label="Command"
				tone="mono"
				action={<CopyButton text={command} />}
			>
				{command}
			</DetailSection>
			<KeyValueList
				items={[
					...(host ? [{ label: "Device", value: host }] : []),
					...(exitCode !== null
						? [{ label: "Exit code", value: String(exitCode) }]
						: []),
				]}
			/>
			{step.status === "running" && (
				<p className="text-xs text-muted-foreground">
					The command is running. Its output shows here when it finishes.
				</p>
			)}
			{output !== null && output !== "" && (
				<DetailSection label="Output" tone="mono">
					{output}
				</DetailSection>
			)}
		</>
	);
}

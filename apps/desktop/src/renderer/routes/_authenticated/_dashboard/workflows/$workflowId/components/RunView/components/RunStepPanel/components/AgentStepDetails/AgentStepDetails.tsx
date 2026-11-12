import type { WorkflowNode } from "@superset/shared/workflow-graph";
import { useHostLabel } from "../../../../../../hooks/useHostLabel";
import type { RunStep } from "../../../../utils/runModel";
import { DetailSection } from "../../../DetailSection";
import { KeyValueList } from "../../../KeyValueList";
import { hasField, stringField } from "../../utils/stepData";
import { JsonBlock } from "../JsonBlock";

interface AgentStepDetailsProps {
	node: Extract<WorkflowNode, { type: "agent" }>;
	step: RunStep;
}

export function AgentStepDetails({ node, step }: AgentStepDetailsProps) {
	const host = useHostLabel(node.config.target.hostId);
	const agent = stringField(step.input, "agent") ?? node.config.agent;
	const model = stringField(step.input, "model") ?? node.config.model;
	const effort = stringField(step.input, "effort") ?? node.config.effort;
	const prompt = stringField(step.input, "prompt") ?? node.config.prompt;
	const text = stringField(step.output, "text");
	return (
		<>
			<KeyValueList
				items={[
					{ label: "Agent", value: agent },
					...(model ? [{ label: "Model", value: model }] : []),
					...(effort ? [{ label: "Effort", value: effort }] : []),
					...(host ? [{ label: "Device", value: host }] : []),
				]}
			/>
			<DetailSection label="Prompt">{prompt}</DetailSection>
			{step.status === "running" && (
				<p className="text-xs text-muted-foreground">
					The agent is working. The result shows here when it finishes.
				</p>
			)}
			{text !== null && text !== "" && (
				<DetailSection label="Result">{text}</DetailSection>
			)}
			{hasField(step.output, "json") && (
				<JsonBlock
					label="Result JSON"
					value={(step.output as { json: unknown }).json}
				/>
			)}
		</>
	);
}

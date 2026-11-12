import type {
	WorkflowLlmEffort,
	WorkflowNode,
} from "@superset/shared/workflow-graph";
import {
	LLM_EFFORT_LABELS,
	llmModelLabel,
} from "../../../../../../utils/nodeText";
import type { RunStep } from "../../../../utils/runModel";
import { DetailSection } from "../../../DetailSection";
import { KeyValueList } from "../../../KeyValueList";
import { hasField, stringField } from "../../utils/stepData";
import { JsonBlock } from "../JsonBlock";

interface LlmStepDetailsProps {
	node: Extract<WorkflowNode, { type: "llm" }>;
	step: RunStep;
}

export function LlmStepDetails({ node, step }: LlmStepDetailsProps) {
	const model = stringField(step.input, "model") ?? node.config.model;
	const effort = stringField(step.input, "effort") ?? node.config.effort;
	const prompt = stringField(step.input, "prompt") ?? node.config.prompt;
	const text = stringField(step.output, "text");
	return (
		<>
			<KeyValueList
				items={[
					{ label: "Model", value: llmModelLabel(model) },
					...(effort
						? [
								{
									label: "Effort",
									value:
										LLM_EFFORT_LABELS[effort as WorkflowLlmEffort] ?? effort,
								},
							]
						: []),
				]}
			/>
			<DetailSection label="Prompt">{prompt}</DetailSection>
			{step.status === "running" && (
				<p className="text-xs text-muted-foreground">
					Waiting for the model to reply.
				</p>
			)}
			{text !== null && <DetailSection label="Result">{text}</DetailSection>}
			{hasField(step.output, "json") && (
				<JsonBlock
					label="Result JSON"
					value={(step.output as { json: unknown }).json}
				/>
			)}
		</>
	);
}

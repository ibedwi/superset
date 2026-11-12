import type { WorkflowNode } from "@superset/shared/workflow-graph";
import { DetailSection } from "../../../DetailSection";
import { conditionText } from "../../utils/conditionText";

interface PlannedStepProps {
	node: WorkflowNode;
	nameOf: (nodeId: string) => string;
	label: string;
}

/** What a step that did not start is set up to do, read from its config. */
export function PlannedStep({ node, nameOf, label }: PlannedStepProps) {
	switch (node.type) {
		case "http":
			return (
				<DetailSection label={label} tone="mono">
					<span className="font-bold">{node.config.method}</span>{" "}
					{node.config.url}
				</DetailSection>
			);
		case "cli":
			return (
				<DetailSection label={label} tone="mono">
					{node.config.command}
				</DetailSection>
			);
		case "llm":
		case "agent":
			return <DetailSection label={label}>{node.config.prompt}</DetailSection>;
		case "condition": {
			const text = conditionText(node.config.expression, nameOf);
			return text ? <DetailSection label={label}>{text}</DetailSection> : null;
		}
		case "trigger":
			return null;
	}
}

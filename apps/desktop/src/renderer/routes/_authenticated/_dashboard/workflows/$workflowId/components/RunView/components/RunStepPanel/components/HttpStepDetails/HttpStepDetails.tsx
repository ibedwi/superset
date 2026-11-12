import { formatNumber } from "@superset/i18n/format";
import type { WorkflowNode } from "@superset/shared/workflow-graph";
import type { RunStep } from "../../../../utils/runModel";
import { DetailSection } from "../../../DetailSection";
import { KeyValueList } from "../../../KeyValueList";
import {
	hasField,
	numberField,
	prettyJson,
	stringField,
	stringListField,
} from "../../utils/stepData";
import { CopyButton } from "../CopyButton";

interface HttpStepDetailsProps {
	node: Extract<WorkflowNode, { type: "http" }>;
	step: RunStep;
}

function formatSize(text: string): string {
	const bytes = new TextEncoder().encode(text).length;
	return bytes < 1024
		? formatNumber(bytes, { style: "unit", unit: "byte", unitDisplay: "short" })
		: formatNumber(bytes / 1024, {
				style: "unit",
				unit: "kilobyte",
				unitDisplay: "short",
				maximumFractionDigits: 1,
			});
}

export function HttpStepDetails({ node, step }: HttpStepDetailsProps) {
	const method = stringField(step.input, "method") ?? node.config.method;
	const url = stringField(step.input, "url") ?? node.config.url;
	const headerNames = stringListField(step.input, "headerNames");
	const status = numberField(step.output, "status");
	const body = stringField(step.output, "body");
	const responseBody = hasField(step.output, "json")
		? prettyJson((step.output as { json: unknown }).json)
		: body;

	return (
		<>
			<DetailSection label="Request" tone="mono">
				<span className="font-bold">{method}</span> {url}
			</DetailSection>
			<KeyValueList
				items={[
					...(headerNames.length > 0
						? [{ label: "Headers", value: headerNames.join(", ") }]
						: []),
					...(status !== null
						? [
								{
									label: "Response",
									value:
										body === null
											? String(status)
											: `${status} · ${formatSize(body)}`,
								},
							]
						: []),
				]}
			/>
			{responseBody !== null && responseBody !== "" && (
				<DetailSection
					label="Response body"
					tone="mono"
					action={<CopyButton text={responseBody} />}
				>
					{responseBody}
				</DetailSection>
			)}
		</>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import {
	type DraftWorkflowNode,
	getWorkflowLlmEfforts,
} from "@superset/shared/workflow-graph";
import {
	LLM_EFFORT_LABELS,
	llmModelLabel,
} from "../../../../../../utils/nodeText";

type LlmConfig = Extract<DraftWorkflowNode, { type: "llm" }>["config"];

export function LlmCardBody({ config }: { config: LlmConfig }) {
	const { t, i18n } = useLingui();
	const model = config.model ?? "";
	const supportsEffort = getWorkflowLlmEfforts(model).length > 0;
	const effort = config.effort
		? t({
				message: `${i18n._(LLM_EFFORT_LABELS[config.effort])} effort`,
			})
		: t({ message: "Default effort" });
	return (
		<>
			<div className="line-clamp-2 text-sm text-muted-foreground">
				{config.prompt || <Trans>Add a prompt to define this step.</Trans>}
			</div>
			<div className="border-t" />
			<div className="truncate text-xs text-muted-foreground">
				{model ? (
					[llmModelLabel(model), supportsEffort ? effort : null]
						.filter(Boolean)
						.join(" · ")
				) : (
					<Trans>Choose a model</Trans>
				)}
			</div>
		</>
	);
}

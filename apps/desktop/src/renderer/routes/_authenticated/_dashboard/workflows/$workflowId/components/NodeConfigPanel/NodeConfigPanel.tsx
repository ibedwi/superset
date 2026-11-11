import { Trans, useLingui } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { LuTrash2 } from "react-icons/lu";
import type { CanvasNode } from "../../utils/graphMapping";
import { AgentNodeForm } from "./components/AgentNodeForm";
import { CliNodeForm } from "./components/CliNodeForm";
import { ConditionNodeForm } from "./components/ConditionNodeForm";
import { HttpNodeForm } from "./components/HttpNodeForm";
import { LlmNodeForm } from "./components/LlmNodeForm";
import { TriggerNodeSection } from "./components/TriggerNodeSection";

interface NodeConfigPanelProps {
	workflowId: string;
	node: CanvasNode | null;
	onChangeNode: (nodeId: string, wf: DraftWorkflowNode) => void;
	onDeleteNode: (nodeId: string) => void;
	readOnly: boolean;
}

export function NodeConfigPanel({
	workflowId,
	node,
	onChangeNode,
	onDeleteNode,
	readOnly,
}: NodeConfigPanelProps) {
	const { t } = useLingui();
	if (!node) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
				<Trans>Select a node to configure it.</Trans>
			</div>
		);
	}

	const wf = node.data.wf;
	const update = (next: DraftWorkflowNode) => onChangeNode(node.id, next);
	// The id is referenced by downstream templates, so it is fixed at creation.
	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="truncate font-mono text-xs text-muted-foreground">
						{wf.id}
					</div>
				</div>
				{wf.type !== "trigger" && !readOnly && (
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => onDeleteNode(node.id)}
						aria-label={t({ message: "Delete node" })}
					>
						<LuTrash2 className="size-3.5" />
					</Button>
				)}
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Name</Trans>
				</Label>
				<Input
					value={wf.name ?? ""}
					onChange={(event) =>
						update({ ...wf, name: event.target.value || undefined })
					}
					placeholder={wf.id}
					disabled={readOnly}
				/>
			</div>

			{wf.type === "trigger" && (
				<TriggerNodeSection workflowId={workflowId} disabled={readOnly} />
			)}
			{wf.type === "agent" && (
				<AgentNodeForm
					config={wf.config}
					onChange={(config) => update({ ...wf, config })}
					disabled={readOnly}
				/>
			)}
			{wf.type === "llm" && (
				<LlmNodeForm
					config={wf.config}
					onChange={(config) => update({ ...wf, config })}
					disabled={readOnly}
				/>
			)}
			{wf.type === "http" && (
				<HttpNodeForm
					config={wf.config}
					onChange={(config) => update({ ...wf, config })}
					disabled={readOnly}
				/>
			)}
			{wf.type === "condition" && (
				<ConditionNodeForm
					config={wf.config}
					onChange={(config) => update({ ...wf, config })}
					disabled={readOnly}
				/>
			)}
			{wf.type === "cli" && (
				<CliNodeForm
					config={wf.config}
					onChange={(config) => update({ ...wf, config })}
					disabled={readOnly}
				/>
			)}
		</div>
	);
}

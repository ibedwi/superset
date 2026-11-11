import { Trans } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Button } from "@superset/ui/button";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import type { ReactNode } from "react";
import { LuTrash2 } from "react-icons/lu";
import type { CanvasEdge, CanvasNode } from "../../utils/graphMapping";
import { NodeTypeIcon } from "../NodeTypeIcon";
import { AgentNodeForm } from "./components/AgentNodeForm";
import { CliNodeForm } from "./components/CliNodeForm";
import { ConditionNodeForm } from "./components/ConditionNodeForm";
import { HttpNodeForm } from "./components/HttpNodeForm";
import { LlmNodeForm } from "./components/LlmNodeForm";
import { TriggerNodeSection } from "./components/TriggerNodeSection";

const TITLES: Record<DraftWorkflowNode["type"], ReactNode> = {
	trigger: <Trans>Trigger</Trans>,
	agent: <Trans>Agent</Trans>,
	llm: <Trans>LLM</Trans>,
	http: <Trans>HTTP request</Trans>,
	condition: <Trans>Condition</Trans>,
	cli: <Trans>Command</Trans>,
};

interface NodeConfigPanelProps {
	workflowId: string;
	node: CanvasNode | null;
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	onChangeNode: (nodeId: string, wf: DraftWorkflowNode) => void;
	onDeleteNode: (nodeId: string) => void;
	readOnly: boolean;
}

export function NodeConfigPanel({
	workflowId,
	node,
	nodes,
	edges,
	onChangeNode,
	onDeleteNode,
	readOnly,
}: NodeConfigPanelProps) {
	if (!node) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
				<Trans>Select a node to configure it.</Trans>
			</div>
		);
	}

	const wf = node.data.wf;
	const update = (next: DraftWorkflowNode) => onChangeNode(node.id, next);
	return (
		<div
			key={node.id}
			className="flex h-full flex-col gap-4 overflow-y-auto p-4"
		>
			<div className="flex flex-col gap-2">
				<div className="flex items-start gap-2.5">
					<NodeTypeIcon type={wf.type} className="mt-0.5" />
					<div className="min-w-0 flex-1">
						<div className="text-base font-medium leading-tight">
							{TITLES[wf.type]}
						</div>
						{wf.type === "llm" && (
							<div className="text-xs text-muted-foreground">
								<Trans>Direct model call</Trans>
							</div>
						)}
					</div>
				</div>
				{wf.type === "llm" && (
					<p className="text-xs text-muted-foreground">
						<Trans>
							Generate a response from a prompt. For workspace tasks and tools,
							use Agent.
						</Trans>
					</p>
				)}
				{/* The id is referenced by downstream templates, so it is fixed at creation. */}
				<div className="text-xs text-muted-foreground">
					<Trans>ID</Trans>{" "}
					<span className="select-all font-mono text-foreground/80">
						{wf.id}
					</span>
				</div>
			</div>

			<div className="border-t" />

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
					nodeId={wf.id}
					nodes={nodes}
					edges={edges}
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

			{wf.type !== "trigger" && !readOnly && (
				<>
					<div className="border-t" />
					<Button
						variant="ghost"
						size="sm"
						className="self-start text-destructive hover:text-destructive"
						onClick={() => onDeleteNode(node.id)}
					>
						<LuTrash2 className="size-3.5" />
						<Trans>Delete node</Trans>
					</Button>
				</>
			)}
		</div>
	);
}

import { Trans } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { cn } from "@superset/ui/utils";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import {
	LuBot,
	LuGlobe,
	LuPlay,
	LuSparkles,
	LuSplit,
	LuTerminal,
} from "react-icons/lu";
import { STEP_STATUS_META } from "../../../../../utils/runStatus";
import type { CanvasNode } from "../../../../utils/graphMapping";

const NODE_ICONS: Record<DraftWorkflowNode["type"], ReactNode> = {
	trigger: <LuPlay className="size-3.5" />,
	agent: <LuBot className="size-3.5" />,
	llm: <LuSparkles className="size-3.5" />,
	http: <LuGlobe className="size-3.5" />,
	condition: <LuSplit className="size-3.5" />,
	cli: <LuTerminal className="size-3.5" />,
};

const NODE_LABELS: Record<DraftWorkflowNode["type"], ReactNode> = {
	trigger: <Trans>Trigger</Trans>,
	agent: <Trans>Agent</Trans>,
	llm: <Trans>LLM</Trans>,
	http: <Trans>HTTP</Trans>,
	condition: <Trans>Condition</Trans>,
	cli: <Trans>Command</Trans>,
};

function summary(node: DraftWorkflowNode): string {
	switch (node.type) {
		case "trigger":
			return "";
		case "agent":
			return node.config.prompt ?? "";
		case "llm":
			return node.config.model || (node.config.prompt ?? "");
		case "http":
			return node.config.url
				? `${node.config.method} ${node.config.url}`
				: (node.config.method ?? "");
		case "condition":
			return node.config.expression ? "if / else" : "";
		case "cli":
			return node.config.command ?? "";
	}
}

const STEP_RING: Record<string, string> = {
	running: "border-amber-500",
	succeeded: "border-emerald-500",
	failed: "border-red-500",
	canceled: "border-amber-500",
};

export function WorkflowNodeCard({ data, selected }: NodeProps<CanvasNode>) {
	const node = data.wf;
	const detail = summary(node);
	const step = data.stepStatus ? STEP_STATUS_META[data.stepStatus] : null;
	return (
		<div
			className={cn(
				"w-56 rounded-lg border bg-card px-3 py-2 shadow-sm transition-colors",
				selected ? "border-primary ring-1 ring-primary" : "border-border",
				data.stepStatus && STEP_RING[data.stepStatus],
				data.stepStatus === "skipped" && "opacity-50",
			)}
		>
			{node.type !== "trigger" && (
				<Handle type="target" position={Position.Left} />
			)}

			<div className="flex items-center gap-2">
				<span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
					{NODE_ICONS[node.type]}
				</span>
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">
						{node.name ?? node.id}
					</div>
					<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
						{NODE_LABELS[node.type]}
					</div>
				</div>
				{step && (
					<span className="flex items-center gap-1 text-[10px] text-muted-foreground">
						<span className={cn("size-1.5 rounded-full", step.dot)} />
						{i18n._(step.label)}
					</span>
				)}
			</div>
			{detail && (
				<div className="mt-1.5 line-clamp-2 break-all text-xs text-muted-foreground">
					{detail}
				</div>
			)}

			{node.type === "condition" ? (
				<>
					<Handle
						id="true"
						type="source"
						position={Position.Right}
						style={{ top: "35%" }}
					/>
					<Handle
						id="false"
						type="source"
						position={Position.Right}
						style={{ top: "70%" }}
					/>
					<div className="pointer-events-none absolute -right-7 top-[35%] -translate-y-1/2 text-[10px] text-muted-foreground">
						<Trans>yes</Trans>
					</div>
					<div className="pointer-events-none absolute -right-6 top-[70%] -translate-y-1/2 text-[10px] text-muted-foreground">
						<Trans>no</Trans>
					</div>
				</>
			) : (
				<Handle type="source" position={Position.Right} />
			)}
		</div>
	);
}

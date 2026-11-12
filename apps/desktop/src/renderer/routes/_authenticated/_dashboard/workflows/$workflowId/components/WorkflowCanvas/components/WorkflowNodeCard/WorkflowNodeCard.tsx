import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { cn } from "@superset/ui/utils";
import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { ReactNode } from "react";
import type { IconType } from "react-icons";
import {
	LuBan,
	LuCircleAlert,
	LuCircleCheck,
	LuCircleDashed,
	LuLoaderCircle,
	LuSkipForward,
} from "react-icons/lu";
import type { CanvasNode, StepStatus } from "../../../../utils/graphMapping";
import { NodeTypeIcon } from "../../../NodeTypeIcon";
import { AgentCardBody } from "./components/AgentCardBody";
import { CliCardBody } from "./components/CliCardBody";
import { ConditionCardBody } from "./components/ConditionCardBody";
import { HttpCardBody } from "./components/HttpCardBody";
import { LlmCardBody } from "./components/LlmCardBody";
import { TriggerCardBody } from "./components/TriggerCardBody";

const SUBTITLES: Partial<Record<DraftWorkflowNode["type"], ReactNode>> = {
	trigger: "Trigger",
	http: "HTTP request",
};

const STEP_LINES: Record<
	StepStatus,
	{ icon: IconType; label: string; className: string }
> = {
	pending: {
		icon: LuCircleDashed,
		label: "Pending",
		className: "text-muted-foreground",
	},
	running: {
		icon: LuLoaderCircle,
		label: "Running",
		className: "text-amber-600 dark:text-amber-400 [&_svg]:animate-spin",
	},
	succeeded: {
		icon: LuCircleCheck,
		label: "Succeeded",
		className: "text-emerald-600 dark:text-emerald-400",
	},
	failed: {
		icon: LuCircleAlert,
		label: "Failed",
		className: "text-red-600 dark:text-red-400",
	},
	skipped: {
		icon: LuSkipForward,
		label: "Skipped",
		className: "text-muted-foreground",
	},
	canceled: {
		icon: LuBan,
		label: "Canceled",
		className: "text-amber-600 dark:text-amber-400",
	},
};

const STEP_BORDER: Partial<Record<StepStatus, string>> = {
	running: "border-amber-500",
	succeeded: "border-emerald-500",
	failed: "border-red-500",
	canceled: "border-amber-500",
};

function renderBody(node: DraftWorkflowNode, stepStatus?: StepStatus) {
	switch (node.type) {
		case "trigger":
			return <TriggerCardBody />;
		case "agent":
			return <AgentCardBody config={node.config} stepStatus={stepStatus} />;
		case "llm":
			return <LlmCardBody config={node.config} />;
		case "http":
			return <HttpCardBody config={node.config} />;
		case "condition":
			return <ConditionCardBody config={node.config} />;
		case "cli":
			return <CliCardBody config={node.config} stepStatus={stepStatus} />;
	}
}

export function WorkflowNodeCard({ data, selected }: NodeProps<CanvasNode>) {
	const node = data.wf;
	const stepStatus = data.stepStatus;
	const step = stepStatus ? STEP_LINES[stepStatus] : null;
	const subtitle =
		node.type === "llm" ? "LLM · Direct model call" : SUBTITLES[node.type];
	return (
		<div
			className={cn(
				"relative flex flex-col gap-2 rounded-xl border bg-card px-3.5 py-3 text-card-foreground shadow-sm transition-colors",
				"w-64",
				selected ? "border-primary ring-1 ring-primary" : "border-border",
				stepStatus && STEP_BORDER[stepStatus],
				stepStatus === "skipped" && "opacity-50",
			)}
		>
			{node.type !== "trigger" && (
				<Handle type="target" position={Position.Top} />
			)}

			<div className="flex items-start gap-2.5">
				<NodeTypeIcon type={node.type} className="mt-0.5" />
				<div className="min-w-0 flex-1">
					<div className="truncate text-sm font-medium">
						{node.name ?? node.id}
					</div>
					{subtitle && (
						<div
							className={cn(
								"text-xs text-muted-foreground",
								node.type !== "llm" && "uppercase tracking-wide text-[10px]",
							)}
						>
							{subtitle}
						</div>
					)}
				</div>
			</div>

			{renderBody(node, stepStatus)}

			{step && (
				<div
					className={cn("flex items-center gap-1.5 text-xs", step.className)}
				>
					<step.icon className="size-3.5" />
					{step.label}
				</div>
			)}

			{node.type === "condition" ? (
				<>
					<Handle
						id="true"
						type="source"
						position={Position.Bottom}
						style={{ left: "30%" }}
						className="!bg-emerald-500"
					/>
					<Handle
						id="false"
						type="source"
						position={Position.Bottom}
						style={{ left: "70%" }}
						className="!bg-stone-400"
					/>
				</>
			) : (
				<Handle type="source" position={Position.Bottom} />
			)}
		</div>
	);
}

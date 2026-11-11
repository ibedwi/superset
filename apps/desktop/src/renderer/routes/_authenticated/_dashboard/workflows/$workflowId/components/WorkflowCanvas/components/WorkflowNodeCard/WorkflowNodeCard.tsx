import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
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
	trigger: <Trans>Trigger</Trans>,
	http: <Trans>HTTP request</Trans>,
};

const STEP_LINES: Record<
	StepStatus,
	{ icon: IconType; label: MessageDescriptor; className: string }
> = {
	pending: {
		icon: LuCircleDashed,
		label: msg({ message: "Pending" }),
		className: "text-muted-foreground",
	},
	running: {
		icon: LuLoaderCircle,
		label: msg({ message: "Running" }),
		className: "text-amber-600 dark:text-amber-400 [&_svg]:animate-spin",
	},
	succeeded: {
		icon: LuCircleCheck,
		label: msg({ message: "Succeeded" }),
		className: "text-emerald-600 dark:text-emerald-400",
	},
	failed: {
		icon: LuCircleAlert,
		label: msg({ message: "Failed" }),
		className: "text-red-600 dark:text-red-400",
	},
	skipped: {
		icon: LuSkipForward,
		label: msg({ message: "Skipped" }),
		className: "text-muted-foreground",
	},
	canceled: {
		icon: LuBan,
		label: msg({ message: "Canceled" }),
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
		node.type === "llm" ? (
			<Trans>LLM · Direct model call</Trans>
		) : (
			SUBTITLES[node.type]
		);
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
				<Handle type="target" position={Position.Left} />
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
					{i18n._(step.label)}
				</div>
			)}

			{node.type !== "condition" && (
				<Handle type="source" position={Position.Right} />
			)}
		</div>
	);
}

import { formatList } from "@superset/i18n/format";
import type {
	WorkflowEdge,
	WorkflowNodeType,
} from "@superset/shared/workflow-graph";
import {
	type RunCause,
	STEP_STATUS_META,
} from "../../../../../utils/runStatus";
import { NodeTypeIcon } from "../../../NodeTypeIcon";
import { formatClockWithMs, formatDuration } from "../../utils/formatDuration";
import type { RunModel, TimelineRow } from "../../utils/runModel";
import { skipReasonText } from "../../utils/skipReason";
import { DetailSection } from "../DetailSection";
import { type KeyValueItem, KeyValueList } from "../KeyValueList";
import { StatusDot } from "../StatusDot";
import { AgentStepDetails } from "./components/AgentStepDetails";
import { CliStepDetails } from "./components/CliStepDetails";
import { ConditionStepDetails } from "./components/ConditionStepDetails";
import { CopyButton } from "./components/CopyButton";
import { HttpStepDetails } from "./components/HttpStepDetails";
import { JsonBlock } from "./components/JsonBlock";
import { LlmStepDetails } from "./components/LlmStepDetails";
import { Notice } from "./components/Notice";
import { PlannedStep } from "./components/PlannedStep";
import { TriggerStepDetails } from "./components/TriggerStepDetails";

const TYPE_LABELS: Record<WorkflowNodeType, string> = {
	trigger: "Trigger",
	agent: "Agent",
	llm: "LLM",
	http: "HTTP request",
	condition: "Condition",
	cli: "Command",
};

interface RunStepPanelProps {
	row: TimelineRow;
	model: RunModel;
	edges: WorkflowEdge[];
	cause: RunCause;
	scheduledFor: Date | string | null;
	triggerContext: unknown;
}

export function RunStepPanel({
	row,
	model,
	edges,
	cause,
	scheduledFor,
	triggerContext,
}: RunStepPanelProps) {
	const { node, step } = row;

	const header = (
		<div>
			<div className="flex items-center gap-2 text-sm font-semibold">
				<NodeTypeIcon type={node.type} />
				<span className="min-w-0 truncate">{row.name}</span>
			</div>
			<div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
				{node.id} · {TYPE_LABELS[node.type]}
			</div>
		</div>
	);

	if (row.status === "skipped") {
		const reason = row.skip ? skipReasonText(row.skip, model.nameOf) : null;
		return (
			<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
				{header}
				<Notice>{reason ? `Skipped because ${reason}.` : "Skipped."}</Notice>
				<PlannedStep node={node} nameOf={model.nameOf} label="Would have run" />
			</div>
		);
	}

	if (row.status === "pending") {
		return (
			<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
				{header}
				<Notice>
					{!model.active ? (
						"Did not run. The run ended before this step started."
					) : row.waitingOn.length > 0 ? (
						<>
							Not started. Waiting for{" "}
							<span className="font-semibold">
								{formatList(row.waitingOn.map(model.nameOf))}
							</span>{" "}
							to finish.
						</>
					) : (
						"Not started yet."
					)}
				</Notice>
				<PlannedStep
					node={node}
					nameOf={model.nameOf}
					label={model.active ? "Will run" : "Would have run"}
				/>
			</div>
		);
	}

	const summary: KeyValueItem[] = [
		{
			label: "Status",
			value: (
				<span className="flex items-center gap-2">
					<StatusDot status={row.status} />
					{STEP_STATUS_META[row.status].label}
				</span>
			),
		},
	];
	if (row.startMs !== null) {
		summary.push({
			label: "Started",
			value: (
				<>
					{formatClockWithMs(model.createdAt + row.startMs)}{" "}
					<span className="text-muted-foreground">
						· +{formatDuration(row.startMs)}
					</span>
				</>
			),
		});
	}
	if (step?.finishedAt && row.endMs !== null) {
		summary.push({
			label: "Finished",
			value: formatClockWithMs(model.createdAt + row.endMs),
		});
	}
	if (row.startMs !== null && row.endMs !== null) {
		summary.push({
			label: "Duration",
			value: `${formatDuration(row.endMs - row.startMs)}${row.status === "running" ? " so far" : ""}`,
		});
	}
	if (step && step.attempt > 1) {
		summary.push({ label: "Attempt", value: String(step.attempt) });
	}

	const details = (() => {
		if (node.type === "trigger") {
			return (
				<TriggerStepDetails
					cause={cause}
					scheduledFor={scheduledFor}
					payload={step?.output ?? triggerContext}
				/>
			);
		}
		if (!step) return null;
		switch (node.type) {
			case "http":
				return <HttpStepDetails node={node} step={step} />;
			case "condition":
				return (
					<ConditionStepDetails
						node={node}
						step={step}
						model={model}
						edges={edges}
					/>
				);
			case "llm":
				return <LlmStepDetails node={node} step={step} />;
			case "agent":
				return <AgentStepDetails node={node} step={step} />;
			case "cli":
				return <CliStepDetails node={node} step={step} />;
		}
	})();

	const hasInput = step?.input !== null && step?.input !== undefined;
	const hasOutput = step?.output !== null && step?.output !== undefined;

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			{header}
			<KeyValueList items={summary} />
			{step?.error && (
				<DetailSection
					label="Error"
					tone="error"
					action={<CopyButton text={step.error} />}
				>
					{step.error}
				</DetailSection>
			)}
			{details}
			{(hasInput || hasOutput) && (
				<details className="group">
					<summary className="cursor-pointer text-xs text-muted-foreground">
						Raw input and output
					</summary>
					<div className="mt-2 flex flex-col gap-3">
						{hasInput && <JsonBlock label="Input" value={step?.input} />}
						{hasOutput && <JsonBlock label="Output" value={step?.output} />}
					</div>
				</details>
			)}
		</div>
	);
}

import { formatDateTime } from "@superset/i18n/format";
import { Button } from "@superset/ui/button";
import { cn } from "@superset/ui/utils";
import { LuCircleStop, LuX } from "react-icons/lu";
import {
	RUN_STATUS_META,
	type RunCause,
	type WorkflowRunStatus,
} from "../../../../../utils/runStatus";
import { formatDuration } from "../../utils/formatDuration";
import type { RunModel } from "../../utils/runModel";

const PILL_STYLES: Record<WorkflowRunStatus, string> = {
	pending: "border-slate-400/40 bg-slate-400/10 text-muted-foreground",
	running:
		"border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400",
	succeeded:
		"border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
	failed: "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400",
	timed_out: "border-red-500/35 bg-red-500/10 text-red-600 dark:text-red-400",
	canceled:
		"border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

export const CAUSE_TEXT: Record<RunCause, string> = {
	manual: "Manual",
	schedule: "Scheduled",
	event: "Event",
};

export interface RunVersionInfo {
	version: number | null;
	liveVersion: number | null;
}

interface RunHeaderProps {
	status: WorkflowRunStatus;
	cause: RunCause;
	model: RunModel;
	version: RunVersionInfo;
	onCancel: () => void;
	cancelDisabled: boolean;
	onBack: () => void;
}

export function RunHeader({
	status,
	cause,
	model,
	version,
	onCancel,
	cancelDisabled,
	onBack,
}: RunHeaderProps) {
	const meta = RUN_STATUS_META[status];
	const started = model.startedMs !== null;
	const soFar = model.active ? " so far" : "";
	const olderThanLive =
		version.version !== null &&
		version.liveVersion !== null &&
		version.version !== version.liveVersion;

	return (
		<div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b px-4 py-2.5 text-sm">
			<span
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-2 text-xs font-semibold",
					PILL_STYLES[status],
				)}
			>
				<span className={cn("size-2 rounded-full", meta.dot)} />
				{meta.label}
			</span>
			<div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
				<span>
					{CAUSE_TEXT[cause]} ·{" "}
					<span className="font-medium text-foreground">
						{formatDateTime(model.createdAt, {
							dateStyle: "medium",
							timeStyle: "medium",
						})}
					</span>
				</span>
				{model.startedMs !== null && (
					<span>
						Took{" "}
						<span className="font-medium text-foreground">
							{formatDuration(model.runEndMs - model.startedMs)}
							{soFar}
						</span>
					</span>
				)}
				<span>
					Queued{" "}
					<span className="font-medium text-foreground">
						{formatDuration(model.queuedMs)}
						{started ? "" : soFar}
					</span>
				</span>
				{version.version !== null && (
					<span
						className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
						title={
							olderThanLive
								? `This run used version ${version.version}. The workflow is now on version ${version.liveVersion}.`
								: `This run used version ${version.version}, the live version.`
						}
					>
						v{version.version}
						{olderThanLive && " · older than live"}
					</span>
				)}
			</div>
			<div className="ml-auto flex items-center gap-2">
				{model.active && (
					<Button
						variant="outline"
						size="sm"
						onClick={onCancel}
						disabled={cancelDisabled}
					>
						<LuCircleStop className="size-3.5" />
						Cancel run
					</Button>
				)}
				<Button variant="ghost" size="sm" onClick={onBack}>
					<LuX className="size-3.5" />
					Back to editor
				</Button>
			</div>
		</div>
	);
}

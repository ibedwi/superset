import type {
	SelectWorkflowRun,
	SelectWorkflowRunStep,
} from "@superset/db/schema";

export type WorkflowRunStatus = SelectWorkflowRun["status"];
export type WorkflowStepStatus = SelectWorkflowRunStep["status"];

export interface StatusMeta {
	dot: string;
	label: string;
	/** True while the status can still change, so views keep polling. */
	active: boolean;
}

export const RUN_STATUS_META: Record<WorkflowRunStatus, StatusMeta> = {
	pending: {
		dot: "bg-slate-400",
		label: "pending",
		active: true,
	},
	running: {
		dot: "bg-amber-500 animate-pulse",
		label: "running",
		active: true,
	},
	succeeded: {
		dot: "bg-emerald-500",
		label: "succeeded",
		active: false,
	},
	failed: {
		dot: "bg-red-500",
		label: "failed",
		active: false,
	},
	canceled: {
		dot: "bg-amber-500",
		label: "canceled",
		active: false,
	},
	timed_out: {
		dot: "bg-red-500",
		label: "timed out",
		active: false,
	},
};

export const STEP_STATUS_META: Record<WorkflowStepStatus, StatusMeta> = {
	pending: {
		dot: "bg-slate-400",
		label: "pending",
		active: true,
	},
	running: {
		dot: "bg-amber-500 animate-pulse",
		label: "running",
		active: true,
	},
	succeeded: {
		dot: "bg-emerald-500",
		label: "succeeded",
		active: false,
	},
	failed: {
		dot: "bg-red-500",
		label: "failed",
		active: false,
	},
	skipped: {
		dot: "bg-slate-300 dark:bg-slate-600",
		label: "skipped",
		active: false,
	},
	canceled: {
		dot: "bg-amber-500",
		label: "canceled",
		active: false,
	},
};

export function isActiveRunStatus(status: WorkflowRunStatus): boolean {
	return RUN_STATUS_META[status].active;
}

export type RunCause = "manual" | "schedule" | "event";

/** The cause is derivable from the row: no trigger means a manual run. */
export function runCause(run: {
	triggerKind: string | null;
	scheduledFor: string | Date | null;
}): RunCause {
	if (run.triggerKind === "schedule" || run.scheduledFor) return "schedule";
	if (run.triggerKind) return "event";
	return "manual";
}

export const RUN_CAUSE_LABELS: Record<RunCause, string> = {
	manual: "manual",
	schedule: "schedule",
	event: "event",
};

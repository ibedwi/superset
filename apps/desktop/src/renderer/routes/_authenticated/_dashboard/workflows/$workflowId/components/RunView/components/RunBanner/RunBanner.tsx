import { formatPercent } from "@superset/i18n/format";
import { Button } from "@superset/ui/button";
import type { WorkflowRunStatus } from "../../../../../utils/runStatus";
import type { TimeInsight } from "../../utils/criticalPath";
import { firstLine } from "../../utils/firstLine";
import { formatDuration } from "../../utils/formatDuration";
import type { RunModel } from "../../utils/runModel";

interface RunBannerProps {
	status: WorkflowRunStatus;
	runError: string | null;
	model: RunModel;
	insight: TimeInsight | null;
	onShowStep: (nodeId: string) => void;
	onShowCriticalPath: () => void;
}

export function RunBanner({
	status,
	runError,
	model,
	insight,
	onShowStep,
	onShowCriticalPath,
}: RunBannerProps) {
	if (status === "failed" || status === "timed_out") {
		const failed = model.failedRow;
		const error = firstLine(failed?.step?.error ?? runError ?? "");
		const verb = status === "timed_out" ? "Timed out" : "Failed";
		const ranMs =
			model.startedMs === null ? null : model.runEndMs - model.startedMs;
		return (
			<div className="flex items-center gap-3 border-b bg-red-500/[0.07] px-4 py-2.5 text-sm">
				<div className="min-w-0 flex-1">
					<div>
						<span className="font-semibold text-red-600 dark:text-red-400">
							{failed
								? `${verb} at ${failed.name}`
								: `Run ${verb.toLowerCase()}`}
						</span>
						{ranMs !== null && (
							<span className="text-muted-foreground">
								{" "}
								after {formatDuration(ranMs)}
							</span>
						)}
					</div>
					{error && (
						<code className="block truncate font-mono text-xs" title={error}>
							{error}
						</code>
					)}
				</div>
				{failed && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => onShowStep(failed.node.id)}
					>
						Show step
					</Button>
				)}
			</div>
		);
	}

	if (status === "succeeded" && insight && model.startedMs !== null) {
		const total = model.runEndMs - model.startedMs;
		const waited = insight.waited;
		return (
			<div className="flex items-center gap-3 border-b px-4 py-2.5 text-sm text-muted-foreground">
				<div className="min-w-0 flex-1">
					Most of this run was{" "}
					<span className="font-semibold text-foreground">
						{model.nameOf(insight.nodeId)}
					</span>
					: {formatDuration(insight.durationMs)} of {formatDuration(total)} (
					{formatPercent(insight.share, { maximumFractionDigits: 0 })}).
					{waited &&
						` ${model.nameOf(waited.nodeId)} finished at ${formatDuration(waited.endMs)} and waited for it.`}
				</div>
				<Button variant="outline" size="sm" onClick={onShowCriticalPath}>
					Show critical path
				</Button>
			</div>
		);
	}

	return null;
}

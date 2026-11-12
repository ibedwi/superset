import { cn } from "@superset/ui/utils";
import type { WorkflowRunStatus } from "../../../../../../../utils/runStatus";
import { formatDuration } from "../../../../utils/formatDuration";
import type { RunModel } from "../../../../utils/runModel";
import { barGeometry, type TimeScale } from "../../utils/timeScale";
import { TrackLabel } from "../TrackLabel";

const RUN_BAR_STYLES: Record<WorkflowRunStatus, string> = {
	pending: "bg-slate-400",
	running: "run-timeline-running",
	succeeded: "bg-emerald-500",
	failed: "bg-red-500",
	timed_out: "bg-red-500",
	canceled: "bg-amber-500",
};

interface TimelineRunTrackProps {
	status: WorkflowRunStatus;
	model: RunModel;
	scale: TimeScale;
	trackPx: number;
}

export function TimelineRunTrack({
	status,
	model,
	scale,
	trackPx,
}: TimelineRunTrackProps) {
	const queued = barGeometry(scale, 0, model.queuedMs);
	const run =
		model.startedMs === null
			? null
			: barGeometry(scale, model.startedMs, model.runEndMs);
	const label =
		model.startedMs === null
			? `Queued ${formatDuration(model.queuedMs)}`
			: formatDuration(model.runEndMs - model.startedMs);
	const end = run ?? queued;
	return (
		<>
			<span
				className="run-timeline-queued absolute top-[9px] h-4 rounded"
				style={{ left: queued.left, width: queued.width }}
				title={`Queued ${formatDuration(model.queuedMs)}`}
			/>
			{run && (
				<span
					className={cn(
						"absolute top-[13px] h-2 rounded opacity-60",
						RUN_BAR_STYLES[status],
					)}
					style={{ left: run.left, width: run.width }}
				/>
			)}
			<TrackLabel
				text={label}
				startPx={end.left}
				endPx={end.left + end.width}
				trackPx={trackPx}
				hasBar
			/>
		</>
	);
}

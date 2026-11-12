import { formatList } from "@superset/i18n/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@superset/ui/tooltip";
import { cn } from "@superset/ui/utils";
import { STEP_STATUS_META } from "../../../../../../../utils/runStatus";
import type { StepStatus } from "../../../../../../utils/graphMapping";
import { firstLine } from "../../../../utils/firstLine";
import {
	formatClockWithMs,
	formatDuration,
} from "../../../../utils/formatDuration";
import type { RunModel, TimelineRow } from "../../../../utils/runModel";
import { skipReasonText } from "../../../../utils/skipReason";
import { barGeometry, type TimeScale } from "../../utils/timeScale";
import { TrackLabel } from "../TrackLabel";

const BAR_STYLES: Partial<Record<StepStatus, string>> = {
	succeeded: "bg-emerald-500",
	failed: "bg-red-500",
	running: "run-timeline-running",
	canceled: "bg-amber-500/60",
};

const GHOST_LINE_PX = 24;
const MIN_WAIT_GAP_PX = 6;

interface TimelineStepTrackProps {
	row: TimelineRow;
	model: RunModel;
	scale: TimeScale;
	trackPx: number;
	/** null when the critical path is hidden. */
	onCriticalPath: boolean | null;
}

function barLabel(row: TimelineRow, durationMs: number): string {
	const duration = formatDuration(durationMs);
	switch (row.status) {
		case "failed": {
			const error = firstLine(row.step?.error ?? "", 48);
			return error ? `${duration} · ${error}` : duration;
		}
		case "running":
			return `${duration} · running`;
		case "canceled":
			return `${duration} · canceled`;
		default:
			return duration;
	}
}

export function TimelineStepTrack({
	row,
	model,
	scale,
	trackPx,
	onCriticalPath,
}: TimelineStepTrackProps) {
	if (row.status === "skipped") {
		const anchorMs =
			row.skip?.kind === "branch"
				? (model.rowsById.get(row.skip.conditionId)?.endMs ?? 0)
				: (row.depEndMs ?? 0);
		const startPx = scale.x(anchorMs);
		const reason = row.skip ? skipReasonText(row.skip, model.nameOf) : null;
		return (
			<>
				<span
					className="absolute top-1/2 border-t-[1.5px] border-dashed border-slate-400/70"
					style={{ left: startPx, width: GHOST_LINE_PX }}
				/>
				<TrackLabel
					text={reason ? `Skipped · ${reason}` : "Skipped"}
					startPx={startPx}
					endPx={startPx + GHOST_LINE_PX}
					trackPx={trackPx}
				/>
			</>
		);
	}

	if (row.status === "pending") {
		const anchorPx = scale.x(model.nowMs ?? model.runEndMs);
		const text = !model.active
			? "Did not run"
			: row.waitingOn.length > 0
				? `Waiting for ${formatList(row.waitingOn.map(model.nameOf))}`
				: "Ready to start";
		return (
			<TrackLabel
				text={text}
				startPx={anchorPx}
				endPx={anchorPx}
				trackPx={trackPx}
			/>
		);
	}

	if (row.startMs === null || row.endMs === null) return null;
	const startMs = row.startMs;
	const endMs = row.endMs;
	const bar = barGeometry(scale, startMs, endMs);
	const waitFromPx = row.depEndMs === null ? null : scale.x(row.depEndMs);
	const showWait =
		waitFromPx !== null && bar.left - waitFromPx > MIN_WAIT_GAP_PX;

	return (
		<>
			{showWait && waitFromPx !== null && (
				<span
					className="pointer-events-none absolute top-1/2 border-t border-dotted border-muted-foreground/70"
					style={{ left: waitFromPx, width: bar.left - waitFromPx }}
				/>
			)}
			<Tooltip delayDuration={150}>
				<TooltipTrigger asChild>
					<span
						className={cn(
							"absolute top-[9px] h-4 rounded",
							BAR_STYLES[row.status],
							onCriticalPath === false && "opacity-25",
							onCriticalPath === true &&
								"ring-2 ring-foreground ring-offset-2 ring-offset-background",
						)}
						style={{ left: bar.left, width: bar.width }}
					/>
				</TooltipTrigger>
				<TooltipContent
					side="top"
					className="max-w-72 px-2.5 py-2 text-xs leading-relaxed"
				>
					<div className="font-semibold text-foreground">{row.name}</div>
					<dl className="grid grid-cols-[64px_auto] gap-x-2">
						<dt>Status</dt>
						<dd className="text-foreground">
							{STEP_STATUS_META[row.status].label}
						</dd>
						<dt>Started</dt>
						<dd className="text-foreground">
							{formatClockWithMs(model.createdAt + startMs)} (+
							{formatDuration(startMs)})
						</dd>
						{row.step?.finishedAt && (
							<>
								<dt>Finished</dt>
								<dd className="text-foreground">
									{formatClockWithMs(model.createdAt + endMs)}
								</dd>
							</>
						)}
						<dt>Duration</dt>
						<dd className="text-foreground">
							{formatDuration(endMs - startMs)}
							{row.status === "running" && " so far"}
						</dd>
					</dl>
				</TooltipContent>
			</Tooltip>
			<TrackLabel
				text={barLabel(row, endMs - startMs)}
				startPx={bar.left}
				endPx={bar.left + bar.width}
				trackPx={trackPx}
				hasBar
				tone={row.status === "failed" ? "error" : "muted"}
			/>
		</>
	);
}

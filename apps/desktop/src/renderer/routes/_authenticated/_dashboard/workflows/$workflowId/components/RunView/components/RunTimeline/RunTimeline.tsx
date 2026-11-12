import "./run-timeline.css";
import { cn } from "@superset/ui/utils";
import {
	type Dispatch,
	type SetStateAction,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	RUN_STATUS_META,
	type WorkflowRunStatus,
} from "../../../../../utils/runStatus";
import { NodeTypeIcon } from "../../../NodeTypeIcon";
import { formatDuration } from "../../utils/formatDuration";
import type { RunModel } from "../../utils/runModel";
import { StatusDot } from "../StatusDot";
import { TimelineRunTrack } from "./components/TimelineRunTrack";
import { TimelineStepTrack } from "./components/TimelineStepTrack";
import { useElementWidth } from "./hooks/useElementWidth";
import {
	createTimeScale,
	MAX_ZOOM,
	MIN_ZOOM,
	pickTickStep,
	tickValues,
} from "./utils/timeScale";

const INSET_PX = 8;
/** Room after the last bar for its duration label. */
const LABEL_RESERVE_PX = 200;
const MIN_TRACK_PX = 240;
const RUN_ROW_ID = "__run";

interface RunTimelineProps {
	status: WorkflowRunStatus;
	model: RunModel;
	selectedNodeId: string | null;
	onSelectNode: (nodeId: string | null) => void;
	zoom: number;
	onZoomChange: Dispatch<SetStateAction<number>>;
	criticalPath: ReadonlySet<string> | null;
}

export function RunTimeline({
	status,
	model,
	selectedNodeId,
	onSelectNode,
	zoom,
	onZoomChange,
	criticalPath,
}: RunTimelineProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const viewPx = useElementWidth(scrollRef);
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const widthPx =
		Math.max(MIN_TRACK_PX, viewPx - INSET_PX - LABEL_RESERVE_PX) * zoom;
	const trackPx = widthPx + INSET_PX + LABEL_RESERVE_PX;
	const scale = createTimeScale(model.totalMs, widthPx, INSET_PX);
	const ticks = tickValues(model.totalMs, pickTickStep(model.totalMs, widthPx));

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const onWheel = (event: WheelEvent) => {
			if (!event.metaKey && !event.ctrlKey) return;
			event.preventDefault();
			const factor = event.deltaY < 0 ? 1.25 : 0.8;
			onZoomChange((current) =>
				Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * factor)),
			);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, [onZoomChange]);

	useEffect(() => {
		if (!selectedNodeId) return;
		const root = rootRef.current;
		const row = root?.querySelector<HTMLElement>(
			`[data-row-id="${CSS.escape(selectedNodeId)}"]`,
		);
		if (!row) return;
		if (root?.contains(document.activeElement)) row.focus();
		else row.scrollIntoView({ block: "nearest" });
	}, [selectedNodeId]);

	const rowState = (rowId: string) => ({
		onMouseEnter: () => setHoveredId(rowId),
		onMouseLeave: () =>
			setHoveredId((current) => (current === rowId ? null : current)),
		onClick: () =>
			onSelectNode(
				rowId === RUN_ROW_ID || rowId === selectedNodeId ? null : rowId,
			),
		className: cn(
			"relative block h-[34px] w-full cursor-pointer text-left",
			hoveredId === rowId && "bg-accent/40",
			selectedNodeId === rowId && "bg-accent",
		),
	});
	const dimmed = (nodeId: string) =>
		criticalPath !== null && !criticalPath.has(nodeId);

	return (
		<div ref={rootRef} className="h-full overflow-y-auto">
			<div className="grid min-h-full grid-cols-[minmax(160px,232px)_minmax(0,1fr)]">
				<div className="border-r">
					<div className="flex h-7 items-center border-b px-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
						Step
					</div>
					<button
						type="button"
						{...rowState(RUN_ROW_ID)}
						className={cn(
							rowState(RUN_ROW_ID).className,
							"flex items-center gap-2 border-b px-3 text-sm font-semibold",
						)}
					>
						<span
							className={cn(
								"size-2 shrink-0 rounded-full",
								RUN_STATUS_META[status].dot,
							)}
						/>
						Run
					</button>
					{model.rows.map((row) => {
						const state = rowState(row.node.id);
						return (
							<button
								key={row.node.id}
								type="button"
								data-row-id={row.node.id}
								{...state}
								className={cn(
									state.className,
									"flex items-center gap-2 px-3 text-sm",
									selectedNodeId === row.node.id &&
										"shadow-[inset_2px_0_0_var(--foreground)]",
								)}
							>
								<NodeTypeIcon type={row.node.type} className="size-3.5" />
								<StatusDot status={row.status} />
								<span
									className={cn(
										"min-w-0 truncate",
										dimmed(row.node.id) && "opacity-45",
									)}
								>
									{row.name}
								</span>
							</button>
						);
					})}
				</div>

				<div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
					<div className="relative min-h-full" style={{ width: trackPx }}>
						<div className="relative h-7 border-b font-mono text-[11px] text-muted-foreground">
							{ticks.map((tick) => (
								<span
									key={tick}
									className="absolute top-2 translate-x-1 whitespace-nowrap"
									style={{ left: scale.x(tick) }}
								>
									{tick === 0 ? "0" : formatDuration(tick)}
								</span>
							))}
						</div>
						{ticks.map((tick) => (
							<span
								key={tick}
								className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/60"
								style={{ left: scale.x(tick) }}
							/>
						))}
						{model.nowMs !== null && (
							<span
								className="pointer-events-none absolute top-0 bottom-0 z-10 border-l-[1.5px] border-amber-500"
								style={{ left: scale.x(model.nowMs) }}
							>
								<span className="absolute top-2 left-1 font-mono text-[10px] font-semibold text-amber-500">
									now
								</span>
							</span>
						)}
						<button
							type="button"
							tabIndex={-1}
							{...rowState(RUN_ROW_ID)}
							className={cn(rowState(RUN_ROW_ID).className, "border-b")}
						>
							<TimelineRunTrack
								status={status}
								model={model}
								scale={scale}
								trackPx={trackPx}
							/>
						</button>
						{model.rows.map((row) => (
							<button
								key={row.node.id}
								type="button"
								tabIndex={-1}
								{...rowState(row.node.id)}
							>
								<TimelineStepTrack
									row={row}
									model={model}
									scale={scale}
									trackPx={trackPx}
									onCriticalPath={
										criticalPath === null ? null : criticalPath.has(row.node.id)
									}
								/>
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}

import { Button } from "@superset/ui/button";
import { Switch } from "@superset/ui/switch";
import { LuMinus, LuPlus } from "react-icons/lu";
import { MAX_ZOOM, MIN_ZOOM } from "../RunTimeline/utils/timeScale";

interface TimelineControlsProps {
	zoom: number;
	onZoomChange: (zoom: number) => void;
	showCriticalPath: boolean;
	onShowCriticalPathChange: (show: boolean) => void;
}

export function TimelineControls({
	zoom,
	onZoomChange,
	showCriticalPath,
	onShowCriticalPathChange,
}: TimelineControlsProps) {
	return (
		<div className="ml-auto flex items-center gap-2">
			<Switch
				id="run-timeline-critical-path"
				checked={showCriticalPath}
				onCheckedChange={onShowCriticalPathChange}
			/>
			<label
				htmlFor="run-timeline-critical-path"
				className="cursor-pointer pr-1 text-xs text-muted-foreground"
			>
				Critical path
			</label>
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Zoom out"
				disabled={zoom <= MIN_ZOOM}
				onClick={() => onZoomChange(Math.max(MIN_ZOOM, zoom / 2))}
			>
				<LuMinus className="size-3.5" />
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={zoom === MIN_ZOOM}
				onClick={() => onZoomChange(MIN_ZOOM)}
				title="Fit (F)"
			>
				Fit
			</Button>
			<Button
				variant="outline"
				size="icon-sm"
				aria-label="Zoom in"
				disabled={zoom >= MAX_ZOOM}
				onClick={() => onZoomChange(Math.min(MAX_ZOOM, zoom * 2))}
			>
				<LuPlus className="size-3.5" />
			</Button>
		</div>
	);
}

import { cn } from "@superset/ui/utils";
import { estimateTextPx, placeLabel } from "../../utils/timeScale";

interface TrackLabelProps {
	text: string;
	startPx: number;
	endPx: number;
	trackPx: number;
	hasBar?: boolean;
	tone?: "muted" | "error";
}

export function TrackLabel({
	text,
	startPx,
	endPx,
	trackPx,
	hasBar = false,
	tone = "muted",
}: TrackLabelProps) {
	const position = placeLabel({
		startPx,
		endPx,
		textPx: estimateTextPx(text),
		trackPx,
		hasBar,
	});
	return (
		<span
			className={cn(
				"pointer-events-none absolute top-0 flex h-full items-center whitespace-nowrap font-mono text-[11px]",
				"inside" in position
					? "z-[1] font-medium text-white"
					: tone === "error"
						? "text-red-600 dark:text-red-400"
						: "text-muted-foreground",
			)}
			style={"inside" in position ? { left: position.inside } : position}
		>
			{text}
		</span>
	);
}

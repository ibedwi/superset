import { cn } from "@superset/ui/utils";
import type { StepStatus } from "../../../../utils/graphMapping";
import type { RunModel } from "../../utils/runModel";

const SEGMENT_STYLES: Record<StepStatus, string> = {
	succeeded: "bg-emerald-500",
	failed: "bg-red-500",
	running: "bg-amber-500",
	canceled: "bg-amber-500/60",
	skipped:
		"bg-[repeating-linear-gradient(90deg,rgb(148_163_184)_0_2px,transparent_2px_4px)]",
	pending: "bg-border",
};

const COUNT_PARTS: {
	status: StepStatus;
	label: string;
	finishedLabel?: string;
	className?: string;
}[] = [
	{ status: "succeeded", label: "done" },
	{
		status: "failed",
		label: "failed",
		className: "text-red-600 dark:text-red-400",
	},
	{
		status: "running",
		label: "running",
		className: "text-amber-600 dark:text-amber-400",
	},
	{ status: "canceled", label: "canceled" },
	{ status: "pending", label: "waiting", finishedLabel: "not run" },
	{ status: "skipped", label: "skipped" },
];

export function StepStrip({ model }: { model: RunModel }) {
	const parts = COUNT_PARTS.filter((part) => model.counts[part.status] > 0);
	return (
		<div className="flex min-w-0 items-center gap-2.5 text-xs text-muted-foreground">
			<div className="flex h-1.5 w-28 shrink-0 gap-0.5">
				{model.rows.map((row) => (
					<span
						key={row.node.id}
						title={`${row.name}: ${row.status}`}
						className={cn("flex-1 rounded-sm", SEGMENT_STYLES[row.status])}
					/>
				))}
			</div>
			<span className="truncate">
				{parts.map((part, index) => (
					<span key={part.status} className={part.className}>
						{index > 0 && " · "}
						{model.counts[part.status]}{" "}
						{model.active ? part.label : (part.finishedLabel ?? part.label)}
					</span>
				))}
			</span>
		</div>
	);
}

import { cn } from "@superset/ui/utils";
import type { StepStatus } from "../../../../utils/graphMapping";

const STYLES: Record<StepStatus, string> = {
	succeeded: "bg-emerald-500",
	failed: "bg-red-500",
	running: "bg-amber-500 animate-pulse",
	canceled: "bg-amber-500/60",
	skipped: "border-[1.5px] border-dashed border-slate-400",
	pending: "border-[1.5px] border-slate-400",
};

/** Status as shape as well as colour: hollow for waiting, dashed for skipped. */
export function StatusDot({
	status,
	className,
}: {
	status: StepStatus;
	className?: string;
}) {
	return (
		<span
			className={cn("size-2 shrink-0 rounded-full", STYLES[status], className)}
		/>
	);
}

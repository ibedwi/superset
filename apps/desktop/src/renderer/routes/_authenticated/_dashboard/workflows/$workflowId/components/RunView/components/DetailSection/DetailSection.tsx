import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";

interface DetailSectionProps {
	label: string;
	action?: ReactNode;
	tone?: "plain" | "mono" | "error";
	children: ReactNode;
}

export function DetailSection({
	label,
	action,
	tone = "plain",
	children,
}: DetailSectionProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex min-h-6 items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
				{label}
				{action}
			</div>
			<div
				className={cn(
					"max-h-64 select-text overflow-auto whitespace-pre-wrap rounded-md border p-2.5 text-xs leading-relaxed [overflow-wrap:anywhere]",
					tone === "mono" && "border-transparent bg-muted/60 font-mono",
					tone === "error" &&
						"border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400",
				)}
			>
				{children}
			</div>
		</div>
	);
}

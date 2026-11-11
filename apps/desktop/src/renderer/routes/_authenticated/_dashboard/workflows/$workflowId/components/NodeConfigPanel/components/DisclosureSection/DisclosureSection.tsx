import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@superset/ui/collapsible";
import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { LuChevronRight } from "react-icons/lu";

interface DisclosureSectionProps {
	title: ReactNode;
	/** Current values, shown while collapsed so hidden settings stay visible. */
	summary?: ReactNode;
	trailing?: ReactNode;
	boxed?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
	children: ReactNode;
}

export function DisclosureSection({
	title,
	summary,
	trailing,
	boxed,
	open,
	onOpenChange,
	defaultOpen,
	children,
}: DisclosureSectionProps) {
	return (
		<Collapsible
			open={open}
			onOpenChange={onOpenChange}
			defaultOpen={defaultOpen}
			className={cn(boxed && "rounded-md bg-muted/50 px-3 py-2.5")}
		>
			<CollapsibleTrigger className="group flex w-full items-start gap-2 text-left">
				<LuChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
				<div className="min-w-0 flex-1">
					<div className="text-sm font-medium">{title}</div>
					{summary && (
						<div className="mt-0.5 truncate text-xs text-muted-foreground group-data-[state=open]:hidden">
							{summary}
						</div>
					)}
				</div>
				{trailing && (
					<span className="text-xs text-muted-foreground">{trailing}</span>
				)}
			</CollapsibleTrigger>
			<CollapsibleContent className="flex flex-col gap-4 pt-3">
				{children}
			</CollapsibleContent>
		</Collapsible>
	);
}

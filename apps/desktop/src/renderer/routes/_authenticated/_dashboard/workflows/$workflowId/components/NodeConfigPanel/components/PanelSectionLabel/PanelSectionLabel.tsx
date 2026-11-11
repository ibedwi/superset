import type { ReactNode } from "react";

export function PanelSectionLabel({ children }: { children: ReactNode }) {
	return (
		<div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
			{children}
		</div>
	);
}

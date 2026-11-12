import type { ReactNode } from "react";

export function Notice({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-md border p-2.5 text-xs leading-relaxed">
			{children}
		</div>
	);
}

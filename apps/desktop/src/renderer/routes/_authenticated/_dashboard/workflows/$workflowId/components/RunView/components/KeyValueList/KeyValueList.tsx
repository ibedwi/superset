import type { ReactNode } from "react";

export interface KeyValueItem {
	label: string;
	value: ReactNode;
}

export function KeyValueList({ items }: { items: KeyValueItem[] }) {
	return (
		<dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-xs">
			{items.map((item) => (
				<div key={item.label} className="contents">
					<dt className="text-muted-foreground">{item.label}</dt>
					<dd className="min-w-0 select-text [overflow-wrap:anywhere]">
						{item.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

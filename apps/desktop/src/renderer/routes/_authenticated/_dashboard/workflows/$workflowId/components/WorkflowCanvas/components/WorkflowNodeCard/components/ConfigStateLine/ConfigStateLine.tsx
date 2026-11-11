import { cn } from "@superset/ui/utils";

interface ConfigStateLineProps {
	configured: boolean;
	timeoutMinutes: number;
}

export function ConfigStateLine({
	configured,
	timeoutMinutes,
}: ConfigStateLineProps) {
	return (
		<div
			className={cn(
				"text-xs",
				configured
					? "text-emerald-600 dark:text-emerald-400"
					: "text-muted-foreground",
			)}
		>
			{configured
				? `Configured · ${timeoutMinutes} min limit`
				: "Needs configuration"}
		</div>
	);
}

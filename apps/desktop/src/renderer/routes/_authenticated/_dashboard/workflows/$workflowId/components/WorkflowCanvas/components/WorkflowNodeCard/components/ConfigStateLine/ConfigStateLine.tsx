import { Trans } from "@lingui/react/macro";
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
			{configured ? (
				<Trans>Configured · {timeoutMinutes} min limit</Trans>
			) : (
				<Trans>Needs configuration</Trans>
			)}
		</div>
	);
}

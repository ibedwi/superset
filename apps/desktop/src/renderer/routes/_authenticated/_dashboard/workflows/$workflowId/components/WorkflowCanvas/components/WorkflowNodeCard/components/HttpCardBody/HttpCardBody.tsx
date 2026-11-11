import { Trans } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import {
	httpEndpointParts,
	httpSummary,
} from "../../../../../../utils/nodeText";

type HttpConfig = Extract<DraftWorkflowNode, { type: "http" }>["config"];

export function HttpCardBody({ config }: { config: HttpConfig }) {
	const url = config.url ?? "";
	const endpoint = httpEndpointParts(url);
	return (
		<>
			<div className="flex flex-col gap-1 font-mono text-xs">
				<div className="flex min-w-0 gap-2">
					<span className="shrink-0 text-emerald-600 dark:text-emerald-400">
						{config.method ?? "GET"}
					</span>
					<span className="truncate">
						{endpoint?.path ??
							(url || (
								<span className="font-sans text-muted-foreground">
									<Trans>Add an endpoint URL</Trans>
								</span>
							))}
					</span>
				</div>
				{endpoint && (
					<div className="truncate text-muted-foreground">{endpoint.host}</div>
				)}
			</div>
			<div className="border-t" />
			<div className="truncate text-xs text-muted-foreground">
				{httpSummary(config)}
			</div>
		</>
	);
}

import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { useHostWorkspaces } from "renderer/routes/_authenticated/providers/HostWorkspacesProvider";
import { useHostLabel } from "../../../../../../hooks/useHostLabel";
import type { StepStatus } from "../../../../../../utils/graphMapping";
import { ConfigStateLine } from "../ConfigStateLine";

type CliConfig = Extract<DraftWorkflowNode, { type: "cli" }>["config"];

interface CliCardBodyProps {
	config: CliConfig;
	stepStatus: StepStatus | undefined;
}

export function CliCardBody({ config, stepStatus }: CliCardBodyProps) {
	const hostId = config.target?.hostId;
	const hostLabel = useHostLabel(hostId);
	const { workspaces } = useHostWorkspaces();
	const workspaceId = config.target?.v2WorkspaceId;
	const workspaceLabel = workspaceId
		? (workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
			workspaceId)
		: undefined;
	return (
		<>
			<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
				Command
			</div>
			<div className="line-clamp-3 whitespace-pre-wrap break-all rounded-md border bg-muted/50 px-2.5 py-2 font-mono text-xs dark:bg-black/30">
				{config.command || (
					<span className="text-muted-foreground">Add a shell command</span>
				)}
			</div>
			<div className="truncate text-xs text-muted-foreground">
				{hostLabel
					? [hostLabel, workspaceLabel].filter(Boolean).join(" · ")
					: "Choose a device to continue"}
			</div>
			{!stepStatus && (
				<ConfigStateLine
					configured={!!hostId && !!config.command}
					timeoutMinutes={config.timeoutMinutes ?? 30}
				/>
			)}
		</>
	);
}

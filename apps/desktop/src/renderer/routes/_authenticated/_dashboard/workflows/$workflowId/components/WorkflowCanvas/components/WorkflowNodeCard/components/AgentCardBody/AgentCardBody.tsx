import { Trans } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { useHostLabel } from "../../../../../../hooks/useHostLabel";
import { useWorkflowAgentChoices } from "../../../../../../hooks/useWorkflowAgentChoices";
import type { StepStatus } from "../../../../../../utils/graphMapping";
import { ConfigStateLine } from "../ConfigStateLine";

type AgentConfig = Extract<DraftWorkflowNode, { type: "agent" }>["config"];

interface AgentCardBodyProps {
	config: AgentConfig;
	stepStatus: StepStatus | undefined;
}

export function AgentCardBody({ config, stepStatus }: AgentCardBodyProps) {
	const hostId = config.target?.hostId;
	const hostLabel = useHostLabel(hostId);
	const { agents } = useWorkflowAgentChoices(hostId);
	const agentLabel =
		agents.find((agent) => agent.id === config.agent)?.label ?? config.agent;
	const configured = !!hostId && !!config.agent && !!config.prompt;
	return (
		<>
			<div className="line-clamp-2 text-sm text-muted-foreground">
				{config.prompt || <Trans>Add a prompt for the agent.</Trans>}
			</div>
			<div className="border-t" />
			<div className="truncate text-xs text-muted-foreground">
				{hostLabel ? (
					[hostLabel, agentLabel].filter(Boolean).join(" · ")
				) : (
					<Trans>Choose where this runs</Trans>
				)}
			</div>
			{!stepStatus && (
				<ConfigStateLine
					configured={configured}
					timeoutMinutes={config.timeoutMinutes ?? 120}
				/>
			)}
		</>
	);
}

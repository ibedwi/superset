import { Trans, useLingui } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { useWorkflowAgentChoices } from "../../../../hooks/useWorkflowAgentChoices";
import { HostSelect } from "../HostSelect";

type AgentConfig = Extract<DraftWorkflowNode, { type: "agent" }>["config"];

interface AgentNodeFormProps {
	config: AgentConfig;
	onChange: (config: AgentConfig) => void;
	disabled: boolean;
}

export function AgentNodeForm({
	config,
	onChange,
	disabled,
}: AgentNodeFormProps) {
	const { t } = useLingui();
	const hostId = config.target?.hostId;
	const { agents } = useWorkflowAgentChoices(hostId);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Device</Trans>
				</Label>
				<HostSelect
					value={hostId}
					onChange={(nextHostId) =>
						onChange({
							...config,
							target: { ...config.target, hostId: nextHostId },
						})
					}
					allowCloud
					disabled={disabled}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Agent</Trans>
				</Label>
				<Select
					value={config.agent || ""}
					onValueChange={(agent) => onChange({ ...config, agent })}
					disabled={disabled}
				>
					<SelectTrigger size="sm" className="w-full">
						<SelectValue placeholder={t({ message: "Select an agent" })} />
					</SelectTrigger>
					<SelectContent>
						{agents.map((agent) => (
							<SelectItem key={agent.id} value={agent.id}>
								{agent.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Prompt</Trans>
				</Label>
				<Textarea
					value={config.prompt ?? ""}
					onChange={(event) =>
						onChange({ ...config, prompt: event.target.value })
					}
					placeholder={t({
						message: "What should the agent do?",
					})}
					rows={8}
					disabled={disabled}
					className="font-mono text-xs"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Timeout (minutes)</Trans>
				</Label>
				<Input
					type="number"
					min={1}
					max={240}
					value={config.timeoutMinutes ?? 120}
					onChange={(event) =>
						onChange({
							...config,
							timeoutMinutes: Number(event.target.value) || 120,
						})
					}
					disabled={disabled}
				/>
			</div>
		</div>
	);
}

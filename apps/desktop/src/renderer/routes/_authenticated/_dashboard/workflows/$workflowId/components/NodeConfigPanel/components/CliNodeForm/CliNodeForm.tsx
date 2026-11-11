import { Trans, useLingui } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Textarea } from "@superset/ui/textarea";
import { HostSelect } from "../HostSelect";

type CliConfig = Extract<DraftWorkflowNode, { type: "cli" }>["config"];

interface CliNodeFormProps {
	config: CliConfig;
	onChange: (config: CliConfig) => void;
	disabled: boolean;
}

export function CliNodeForm({ config, onChange, disabled }: CliNodeFormProps) {
	const { t } = useLingui();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Device</Trans>
				</Label>
				<HostSelect
					value={config.target?.hostId}
					onChange={(hostId) =>
						onChange({ ...config, target: { ...config.target, hostId } })
					}
					allowCloud={false}
					disabled={disabled}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Workspace ID</Trans>
				</Label>
				<Input
					value={config.target?.v2WorkspaceId ?? ""}
					onChange={(event) =>
						onChange({
							...config,
							target: config.target
								? {
										...config.target,
										v2WorkspaceId: event.target.value || undefined,
									}
								: undefined,
						})
					}
					placeholder={t({ message: "Workspace to run in" })}
					disabled={disabled || !config.target}
					className="font-mono text-xs"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Command</Trans>
				</Label>
				<Textarea
					value={config.command ?? ""}
					onChange={(event) =>
						onChange({ ...config, command: event.target.value })
					}
					placeholder="bun run test"
					rows={4}
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
					max={120}
					value={config.timeoutMinutes ?? 30}
					onChange={(event) =>
						onChange({
							...config,
							timeoutMinutes: Number(event.target.value) || 30,
						})
					}
					disabled={disabled}
				/>
			</div>
		</div>
	);
}

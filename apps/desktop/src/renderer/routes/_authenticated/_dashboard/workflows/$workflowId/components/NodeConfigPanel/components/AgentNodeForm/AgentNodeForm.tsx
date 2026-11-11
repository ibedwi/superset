import { Trans, useLingui } from "@lingui/react/macro";
import { formatList } from "@superset/i18n/format";
import {
	getAgentEfforts,
	getAgentModelSupport,
} from "@superset/shared/agent-models";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { cn } from "@superset/ui/utils";
import { LuCheck } from "react-icons/lu";
import { AgentModelSelect } from "renderer/components/AgentModelSelect";
import { useWorkflowAgentChoices } from "../../../../hooks/useWorkflowAgentChoices";
import { BoundedNumberField } from "../BoundedNumberField";
import { DisclosureSection } from "../DisclosureSection";
import { HostSelect } from "../HostSelect";
import { PanelSectionLabel } from "../PanelSectionLabel";

type AgentConfig = Extract<DraftWorkflowNode, { type: "agent" }>["config"];

const DEFAULT_TIMEOUT_MINUTES = 120;

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
	const agent = agents.find((candidate) => candidate.id === config.agent);
	const presetId = agent?.launchPresetId ?? agent?.presetId ?? agent?.id;
	const modelSupport = presetId ? getAgentModelSupport(presetId) : undefined;
	const efforts = presetId ? getAgentEfforts(presetId, config.model) : [];
	const selectedEffort = efforts.some((option) => option.id === config.effort)
		? config.effort
		: undefined;
	const modelLabel = config.model
		? (modelSupport?.models.find((model) => model.id === config.model)?.label ??
			config.model)
		: t({ message: "Default model" });
	const effortLabel =
		efforts.find((option) => option.id === selectedEffort)?.label ??
		t({ message: "Default effort" });
	const timeoutMinutes = config.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES;
	const missing = [
		!hostId && t({ message: "device" }),
		!config.agent && t({ message: "agent" }),
		!config.prompt && t({ message: "prompt" }),
	].filter((field): field is string => !!field);
	const missingText = formatList(missing);

	return (
		<div className="flex flex-col gap-4">
			<PanelSectionLabel>
				<Trans>Execution</Trans>
			</PanelSectionLabel>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Run on</Trans>
				</Label>
				<HostSelect
					value={hostId}
					onChange={(nextHostId) =>
						onChange({
							...config,
							agent: "",
							model: undefined,
							effort: undefined,
							target: { ...config.target, hostId: nextHostId },
						})
					}
					allowCloud
					disabled={disabled}
				/>
				<p className="text-xs text-muted-foreground">
					<Trans>Changing device clears agent, model and effort.</Trans>
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Agent</Trans>
				</Label>
				<Select
					value={config.agent || ""}
					onValueChange={(agent) =>
						onChange({ ...config, agent, model: undefined, effort: undefined })
					}
					disabled={disabled || !hostId}
				>
					<SelectTrigger size="sm" className="w-full">
						<SelectValue
							placeholder={
								hostId
									? t({ message: "Select an agent" })
									: t({ message: "Choose a device first" })
							}
						/>
					</SelectTrigger>
					<SelectContent>
						{agents.map((agent) => (
							<SelectItem key={agent.id} value={agent.id}>
								{agent.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<p className="text-xs text-muted-foreground">
					<Trans>Available agents depend on the selected device.</Trans>
				</p>
			</div>

			{modelSupport && (
				<DisclosureSection
					boxed
					title={<Trans>Launch options</Trans>}
					summary={`${modelLabel} · ${effortLabel}`}
				>
					<div className="flex flex-col gap-1.5">
						<Label>
							<Trans>Model</Trans>
						</Label>
						<AgentModelSelect
							models={modelSupport.models}
							value={config.model ?? null}
							onValueChange={(model) =>
								onChange({
									...config,
									model: model ?? undefined,
									effort:
										presetId &&
										getAgentEfforts(presetId, model ?? undefined).some(
											(option) => option.id === config.effort,
										)
											? config.effort
											: undefined,
								})
							}
							defaultLabel={t({ message: "Default model" })}
							triggerClassName="w-full h-8"
							disabled={disabled}
						/>
					</div>
					{efforts.length > 0 && (
						<div className="flex flex-col gap-1.5">
							<Label>
								<Trans>Effort</Trans>
							</Label>
							<Select
								value={selectedEffort ?? "__default__"}
								onValueChange={(effort) =>
									onChange({
										...config,
										effort: effort === "__default__" ? undefined : effort,
									})
								}
								disabled={disabled}
							>
								<SelectTrigger size="sm" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__default__">
										<Trans>Default effort</Trans>
									</SelectItem>
									{efforts.map((effort) => (
										<SelectItem key={effort.id} value={effort.id}>
											{effort.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</DisclosureSection>
			)}

			<div className="border-t" />

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
					className="min-h-36 text-sm"
				/>
			</div>

			<DisclosureSection
				title={<Trans>Limits</Trans>}
				summary={
					timeoutMinutes === DEFAULT_TIMEOUT_MINUTES ? (
						<Trans>Timeout {timeoutMinutes} min · Default</Trans>
					) : (
						<Trans>Timeout {timeoutMinutes} min</Trans>
					)
				}
			>
				<BoundedNumberField
					label={<Trans>Timeout</Trans>}
					unit={<Trans>minutes</Trans>}
					value={timeoutMinutes}
					min={1}
					max={240}
					defaultValue={DEFAULT_TIMEOUT_MINUTES}
					onChange={(timeoutMinutes) => onChange({ ...config, timeoutMinutes })}
					disabled={disabled}
				/>
			</DisclosureSection>

			<div className="border-t" />

			<div className="flex flex-col gap-1">
				<div
					className={cn(
						"flex items-center gap-1.5 text-sm",
						missing.length === 0
							? "text-emerald-600 dark:text-emerald-400"
							: "text-muted-foreground",
					)}
				>
					{missing.length === 0 ? (
						<>
							<LuCheck className="size-3.5" />
							<Trans>Required fields complete</Trans>
						</>
					) : (
						<Trans>Missing: {missingText}</Trans>
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					<Trans>
						Configuration check only; availability is checked when the workflow
						runs.
					</Trans>
				</p>
			</div>
		</div>
	);
}

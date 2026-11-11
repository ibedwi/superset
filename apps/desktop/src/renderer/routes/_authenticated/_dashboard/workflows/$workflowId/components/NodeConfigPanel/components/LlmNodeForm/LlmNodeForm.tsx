import { formatNumber } from "@superset/i18n/format";
import {
	type DraftWorkflowNode,
	getWorkflowLlmEfforts,
	WORKFLOW_LLM_MODELS,
} from "@superset/shared/workflow-graph";
import { Label } from "@superset/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@superset/ui/select";
import { Textarea } from "@superset/ui/textarea";
import { LLM_EFFORT_LABELS, llmModelLabel } from "../../../../utils/nodeText";
import { BoundedNumberField } from "../BoundedNumberField";
import { DisclosureSection } from "../DisclosureSection";

type LlmConfig = Extract<DraftWorkflowNode, { type: "llm" }>["config"];

const DEFAULT_MAX_TOKENS = 4096;

interface LlmNodeFormProps {
	config: LlmConfig;
	onChange: (config: LlmConfig) => void;
	disabled: boolean;
}

export function LlmNodeForm({ config, onChange, disabled }: LlmNodeFormProps) {
	const efforts = getWorkflowLlmEfforts(config.model);
	const selectedEffort = efforts.find((effort) => effort === config.effort);
	const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
	const maxTokensText = formatNumber(maxTokens);
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					Model <span className="text-muted-foreground">*</span>
				</Label>
				<Select
					value={config.model || ""}
					onValueChange={(model) =>
						onChange({
							...config,
							model,
							effort: getWorkflowLlmEfforts(model).find(
								(effort) => effort === config.effort,
							),
						})
					}
					disabled={disabled}
				>
					<SelectTrigger size="sm" className="w-full">
						<SelectValue placeholder="Select a model…">
							{config.model ? llmModelLabel(config.model) : undefined}
						</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{config.model &&
							!WORKFLOW_LLM_MODELS.some(
								(model) => model.id === config.model,
							) && <SelectItem value={config.model}>{config.model}</SelectItem>}
						{WORKFLOW_LLM_MODELS.map((model) => (
							<SelectItem key={model.id} value={model.id}>
								<div className="flex flex-col">
									<span>{model.label}</span>
									<span className="font-mono text-[11px] text-muted-foreground">
										{model.id}
									</span>
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{config.model && (
					<p className="text-xs text-muted-foreground">
						Anthropic · <span className="font-mono">{config.model}</span>
					</p>
				)}
			</div>

			{efforts.length > 0 && (
				<div className="flex flex-col gap-1.5">
					<Label>Effort</Label>
					<Select
						value={selectedEffort ?? "__default__"}
						onValueChange={(value) =>
							onChange({
								...config,
								effort: efforts.find((effort) => effort === value),
							})
						}
						disabled={disabled}
					>
						<SelectTrigger size="sm" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="__default__">Default effort</SelectItem>
							{efforts.map((effort) => (
								<SelectItem key={effort} value={effort}>
									{LLM_EFFORT_LABELS[effort]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-xs text-muted-foreground">
						Reasoning effort · available for this model
					</p>
				</div>
			)}

			<div className="border-t" />

			<div className="flex flex-col gap-1.5">
				<Label>
					Prompt <span className="text-muted-foreground">*</span>
				</Label>
				<Textarea
					value={config.prompt ?? ""}
					onChange={(event) =>
						onChange({ ...config, prompt: event.target.value })
					}
					placeholder="What should the model do?"
					rows={8}
					disabled={disabled}
					className="min-h-36 font-mono text-xs"
				/>
				<p className="text-xs text-muted-foreground">
					The task and input sent to the model.
				</p>
			</div>

			<DisclosureSection
				title="System prompt"
				trailing="Optional"
				summary="Set the model's role and response rules."
				defaultOpen={!!config.system}
			>
				<Textarea
					value={config.system ?? ""}
					onChange={(event) =>
						onChange({
							...config,
							system: event.target.value || undefined,
						})
					}
					placeholder="You are a concise code reviewer."
					rows={3}
					disabled={disabled}
					className="font-mono text-xs"
					aria-label="System instructions"
				/>
			</DisclosureSection>

			<div className="border-t" />

			<DisclosureSection
				title="Generation settings"
				summary={
					maxTokens === DEFAULT_MAX_TOKENS
						? `Max tokens ${maxTokensText} · default`
						: `Max tokens ${maxTokensText}`
				}
			>
				<BoundedNumberField
					label="Max tokens"
					value={maxTokens}
					min={1}
					max={64_000}
					defaultValue={DEFAULT_MAX_TOKENS}
					hint="Response limit. Raise it only for longer replies."
					onChange={(maxTokens) => onChange({ ...config, maxTokens })}
					disabled={disabled}
				/>
			</DisclosureSection>
		</div>
	);
}

import { Trans, useLingui } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Input } from "@superset/ui/input";
import { Label } from "@superset/ui/label";
import { Textarea } from "@superset/ui/textarea";

type LlmConfig = Extract<DraftWorkflowNode, { type: "llm" }>["config"];

interface LlmNodeFormProps {
	config: LlmConfig;
	onChange: (config: LlmConfig) => void;
	disabled: boolean;
}

export function LlmNodeForm({ config, onChange, disabled }: LlmNodeFormProps) {
	const { t } = useLingui();
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Model</Trans>
				</Label>
				<Input
					value={config.model ?? ""}
					onChange={(event) =>
						onChange({ ...config, model: event.target.value })
					}
					placeholder="claude-haiku-4-5"
					disabled={disabled}
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>System prompt</Trans>
				</Label>
				<Textarea
					value={config.system ?? ""}
					onChange={(event) =>
						onChange({
							...config,
							system: event.target.value || undefined,
						})
					}
					rows={3}
					disabled={disabled}
					className="font-mono text-xs"
				/>
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
					placeholder={t({ message: "What should the model do?" })}
					rows={8}
					disabled={disabled}
					className="font-mono text-xs"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Max tokens</Trans>
				</Label>
				<Input
					type="number"
					min={1}
					max={64_000}
					value={config.maxTokens ?? 4096}
					onChange={(event) =>
						onChange({
							...config,
							maxTokens: Number(event.target.value) || 4096,
						})
					}
					disabled={disabled}
				/>
			</div>
		</div>
	);
}

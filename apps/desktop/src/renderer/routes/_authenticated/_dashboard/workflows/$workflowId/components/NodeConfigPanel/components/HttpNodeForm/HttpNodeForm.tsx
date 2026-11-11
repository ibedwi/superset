import { Trans, useLingui } from "@lingui/react/macro";
import type { DraftWorkflowNode } from "@superset/shared/workflow-graph";
import { Button } from "@superset/ui/button";
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
import { LuPlus, LuX } from "react-icons/lu";

type HttpConfig = Extract<DraftWorkflowNode, { type: "http" }>["config"];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;

interface HttpNodeFormProps {
	config: HttpConfig;
	onChange: (config: HttpConfig) => void;
	disabled: boolean;
}

export function HttpNodeForm({
	config,
	onChange,
	disabled,
}: HttpNodeFormProps) {
	const { t } = useLingui();
	const headers = Object.entries(config.headers ?? {});

	const setHeaders = (entries: [string, string][]) =>
		onChange({ ...config, headers: Object.fromEntries(entries) });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Request</Trans>
				</Label>
				<div className="flex gap-2">
					<Select
						value={config.method ?? "GET"}
						onValueChange={(method) =>
							onChange({ ...config, method: method as HttpConfig["method"] })
						}
						disabled={disabled}
					>
						<SelectTrigger size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{METHODS.map((method) => (
								<SelectItem key={method} value={method}>
									{method}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						value={config.url ?? ""}
						onChange={(event) =>
							onChange({ ...config, url: event.target.value })
						}
						placeholder="https://api.example.com/path"
						disabled={disabled}
						className="flex-1 font-mono text-xs"
					/>
				</div>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Headers</Trans>
				</Label>
				{headers.map(([key, value], index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: positional rows whose key text is itself being edited
					<div key={index} className="flex gap-2">
						<Input
							value={key}
							onChange={(event) => {
								const next = [...headers] as [string, string][];
								next[index] = [event.target.value, value];
								setHeaders(next);
							}}
							placeholder={t({ message: "Name" })}
							disabled={disabled}
							className="flex-1 font-mono text-xs"
						/>
						<Input
							value={value}
							onChange={(event) => {
								const next = [...headers] as [string, string][];
								next[index] = [key, event.target.value];
								setHeaders(next);
							}}
							placeholder={t({ message: "Value" })}
							disabled={disabled}
							className="flex-1 font-mono text-xs"
						/>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={() =>
								setHeaders(
									headers.filter((_, i) => i !== index) as [string, string][],
								)
							}
							disabled={disabled}
							aria-label={t({ message: "Remove header" })}
						>
							<LuX className="size-3.5" />
						</Button>
					</div>
				))}
				<Button
					variant="outline"
					size="sm"
					className="self-start"
					onClick={() =>
						setHeaders([...headers, ["", ""]] as [string, string][])
					}
					disabled={disabled}
				>
					<LuPlus className="size-3.5" />
					<Trans>Add header</Trans>
				</Button>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Body</Trans>
				</Label>
				<Textarea
					value={config.body ?? ""}
					onChange={(event) =>
						onChange({ ...config, body: event.target.value || undefined })
					}
					rows={5}
					disabled={disabled}
					className="font-mono text-xs"
				/>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Timeout (seconds)</Trans>
				</Label>
				<Input
					type="number"
					min={1}
					max={300}
					value={config.timeoutSeconds ?? 30}
					onChange={(event) =>
						onChange({
							...config,
							timeoutSeconds: Number(event.target.value) || 30,
						})
					}
					disabled={disabled}
				/>
			</div>
		</div>
	);
}

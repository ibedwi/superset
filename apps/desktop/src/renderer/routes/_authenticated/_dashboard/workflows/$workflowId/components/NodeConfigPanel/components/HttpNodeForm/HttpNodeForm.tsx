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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { Textarea } from "@superset/ui/textarea";
import { Fragment } from "react";
import { LuPlus } from "react-icons/lu";
import { httpSummary } from "../../../../utils/nodeText";
import { BoundedNumberField } from "../BoundedNumberField";

type HttpConfig = Extract<DraftWorkflowNode, { type: "http" }>["config"];

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const DEFAULT_TIMEOUT_SECONDS = 30;
const TAB_TRIGGER_CLASS =
	"h-9 flex-none rounded-none border-0 border-b-2 border-transparent px-0 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none dark:data-[state=active]:border-primary dark:data-[state=active]:bg-transparent";

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
	const method = config.method ?? "GET";

	const setHeaders = (entries: [string, string][]) =>
		onChange({ ...config, headers: Object.fromEntries(entries) });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Method</Trans>
				</Label>
				<Select
					value={method}
					onValueChange={(method) =>
						onChange({ ...config, method: method as HttpConfig["method"] })
					}
					disabled={disabled}
				>
					<SelectTrigger size="sm" className="w-full">
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
			</div>

			<div className="flex flex-col gap-1.5">
				<Label>
					<Trans>Endpoint URL</Trans>
				</Label>
				<Textarea
					value={config.url ?? ""}
					onChange={(event) =>
						onChange({
							...config,
							url: event.target.value.replace(/[\r\n]+/g, ""),
						})
					}
					placeholder="https://api.example.com/path"
					rows={2}
					disabled={disabled}
					className="min-h-0 resize-none break-all font-mono text-xs"
				/>
				<p className="text-xs text-muted-foreground">{httpSummary(config)}</p>
			</div>

			<Tabs defaultValue="body" className="gap-4">
				<TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b bg-transparent p-0">
					<TabsTrigger value="headers" className={TAB_TRIGGER_CLASS}>
						<Trans>Headers</Trans>
						{headers.length > 0 && (
							<span className="text-muted-foreground">{headers.length}</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="body" className={TAB_TRIGGER_CLASS}>
						<Trans>Body</Trans>
					</TabsTrigger>
					<TabsTrigger value="settings" className={TAB_TRIGGER_CLASS}>
						<Trans>Settings</Trans>
					</TabsTrigger>
				</TabsList>

				<TabsContent value="headers" className="flex flex-col gap-3">
					<p className="text-xs text-muted-foreground">
						<Trans>Authentication uses request headers.</Trans>
					</p>
					{headers.map(([key, value], index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: positional rows whose key text is itself being edited
						<Fragment key={index}>
							{index > 0 && <div className="border-t" />}
							<div className="flex flex-col gap-2">
								<Input
									value={key}
									onChange={(event) => {
										const next = [...headers] as [string, string][];
										next[index] = [event.target.value, value];
										setHeaders(next);
									}}
									placeholder={t({ message: "Header name" })}
									disabled={disabled}
									className="font-mono text-xs"
								/>
								<Textarea
									value={value}
									onChange={(event) => {
										const next = [...headers] as [string, string][];
										next[index] = [key, event.target.value];
										setHeaders(next);
									}}
									placeholder={t({ message: "Value" })}
									rows={1}
									disabled={disabled}
									className="min-h-9 font-mono text-xs"
								/>
								{!disabled && (
									<button
										type="button"
										className="self-start text-xs text-muted-foreground hover:text-foreground"
										onClick={() =>
											setHeaders(
												headers.filter((_, i) => i !== index) as [
													string,
													string,
												][],
											)
										}
									>
										<Trans>Remove header</Trans>
									</button>
								)}
							</div>
						</Fragment>
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
				</TabsContent>

				<TabsContent value="body" className="flex flex-col gap-1.5">
					<div className="text-sm font-medium">
						<Trans>Request body</Trans>
					</div>
					<p className="text-xs text-muted-foreground">
						<Trans>Raw text sent with this request.</Trans>
					</p>
					<Textarea
						value={config.body ?? ""}
						onChange={(event) =>
							onChange({ ...config, body: event.target.value || undefined })
						}
						placeholder={t({ message: "Enter raw request body…" })}
						rows={10}
						disabled={disabled}
						className="min-h-48 font-mono text-xs"
						aria-label={t({ message: "Request body" })}
					/>
					<p className="text-xs text-muted-foreground">
						{method === "GET" || method === "HEAD" ? (
							<Trans>Optional. GET and HEAD usually leave this empty.</Trans>
						) : (
							<Trans>
								Optional. Set Content-Type in Headers when your endpoint expects
								a specific body format.
							</Trans>
						)}
					</p>
				</TabsContent>

				<TabsContent value="settings">
					<BoundedNumberField
						label={<Trans>Request timeout</Trans>}
						unit={<Trans>seconds</Trans>}
						value={config.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS}
						min={1}
						max={300}
						defaultValue={DEFAULT_TIMEOUT_SECONDS}
						hint={
							<Trans>
								1–300 seconds. The request fails when it takes longer.
							</Trans>
						}
						onChange={(timeoutSeconds) =>
							onChange({ ...config, timeoutSeconds })
						}
						disabled={disabled}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}

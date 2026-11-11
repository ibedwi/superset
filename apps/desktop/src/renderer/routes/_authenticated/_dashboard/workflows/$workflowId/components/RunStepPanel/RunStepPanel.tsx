import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
import { formatDateTime, formatElapsed } from "@superset/i18n/format";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { cn } from "@superset/ui/utils";
import type { ReactNode } from "react";
import { LuCopy } from "react-icons/lu";
import { STEP_STATUS_META } from "../../../utils/runStatus";

export interface RunStepRow {
	nodeId: string;
	nodeType: string;
	status: keyof typeof STEP_STATUS_META;
	input: unknown;
	output: unknown;
	error: string | null;
	attempt: number;
	startedAt: string | Date | null;
	finishedAt: string | Date | null;
}

interface RunStepPanelProps {
	step: RunStepRow | null;
}

function JsonBlock({ title, value }: { title: ReactNode; value: unknown }) {
	const { t } = useLingui();
	const text = JSON.stringify(value, null, 2) ?? "";
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-muted-foreground">
					{title}
				</span>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={t({ message: "Copy" })}
					onClick={() => {
						navigator.clipboard.writeText(text).then(
							() => toast.success(t({ message: "Copied" })),
							() => toast.error(t({ message: "Couldn't copy" })),
						);
					}}
				>
					<LuCopy className="size-3" />
				</Button>
			</div>
			<pre className="max-h-64 select-text overflow-auto rounded-md border bg-muted/40 p-2 text-xs">
				{text}
			</pre>
		</div>
	);
}

export function RunStepPanel({ step }: RunStepPanelProps) {
	if (!step) {
		return (
			<div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
				<Trans>Select a node to see its step.</Trans>
			</div>
		);
	}

	const meta = STEP_STATUS_META[step.status];
	const output = step.output as
		| { text?: unknown; json?: unknown }
		| null
		| undefined;
	const agentText =
		output && typeof output.text === "string" ? output.text : null;

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			<div>
				<div className="truncate font-mono text-xs text-muted-foreground">
					{step.nodeId}
				</div>
				<div className="mt-1 flex items-center gap-2">
					<span className={cn("size-2 rounded-full", meta.dot)} />
					<span className="text-sm font-medium">{i18n._(meta.label)}</span>
					{step.attempt > 1 && (
						<span className="text-xs text-muted-foreground">
							<Trans>attempt {step.attempt}</Trans>
						</span>
					)}
				</div>
			</div>

			<div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
				{step.startedAt && (
					<span>
						<Trans>Started</Trans> {formatDateTime(new Date(step.startedAt))}
					</span>
				)}
				{step.startedAt && step.finishedAt && (
					<span>
						<Trans>Duration</Trans>{" "}
						{formatElapsed(new Date(step.startedAt), new Date(step.finishedAt))}
					</span>
				)}
			</div>

			{step.error && (
				<div className="select-text whitespace-pre-wrap rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-400">
					{step.error}
				</div>
			)}

			{agentText && (
				<div className="flex flex-col gap-1">
					<span className="text-xs font-medium text-muted-foreground">
						<Trans>Result</Trans>
					</span>
					<div className="max-h-64 select-text overflow-auto whitespace-pre-wrap rounded-md border p-2 text-xs">
						{agentText}
					</div>
				</div>
			)}

			{output?.json !== undefined && (
				<JsonBlock title={<Trans>Result JSON</Trans>} value={output.json} />
			)}
			{step.output !== null &&
				step.output !== undefined &&
				output?.json === undefined &&
				!agentText && (
					<JsonBlock title={<Trans>Output</Trans>} value={step.output} />
				)}
			{step.input !== null && step.input !== undefined && (
				<JsonBlock title={<Trans>Input</Trans>} value={step.input} />
			)}
		</div>
	);
}

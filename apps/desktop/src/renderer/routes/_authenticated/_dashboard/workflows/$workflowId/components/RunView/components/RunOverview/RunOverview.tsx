import { formatDateTime } from "@superset/i18n/format";
import type { RunCause } from "../../../../../utils/runStatus";
import { formatClockWithMs, formatDuration } from "../../utils/formatDuration";
import type { RunModel } from "../../utils/runModel";
import { DetailSection } from "../DetailSection";
import { type KeyValueItem, KeyValueList } from "../KeyValueList";
import { CAUSE_TEXT, type RunVersionInfo } from "../RunHeader";

interface RunOverviewProps {
	runId: string;
	cause: RunCause;
	error: string | null;
	model: RunModel;
	version: RunVersionInfo;
}

export function RunOverview({
	runId,
	cause,
	error,
	model,
	version,
}: RunOverviewProps) {
	const { counts } = model;
	const tiles = [
		{ label: "done", value: counts.succeeded },
		counts.running > 0
			? { label: "running", value: counts.running }
			: { label: "failed", value: counts.failed },
		{ label: "skipped", value: counts.skipped },
		{
			label: model.active ? "so far" : "total",
			value:
				model.startedMs === null
					? "—"
					: formatDuration(model.runEndMs - model.startedMs),
		},
	];

	const items: KeyValueItem[] = [
		{ label: "Trigger", value: CAUSE_TEXT[cause] },
		{
			label: "Created",
			value: formatDateTime(model.createdAt, {
				dateStyle: "medium",
				timeStyle: "medium",
			}),
		},
	];
	if (model.startedMs !== null) {
		items.push({
			label: "Started",
			value: (
				<>
					{formatClockWithMs(model.createdAt + model.startedMs)}{" "}
					<span className="text-muted-foreground">
						· queued {formatDuration(model.queuedMs)}
					</span>
				</>
			),
		});
	}
	if (!model.active) {
		items.push({
			label: "Finished",
			value: formatClockWithMs(model.createdAt + model.runEndMs),
		});
	}
	if (version.version !== null) {
		items.push({
			label: "Version",
			value:
				version.liveVersion !== null && version.liveVersion !== version.version
					? `${version.version} (live is ${version.liveVersion})`
					: String(version.version),
		});
	}

	return (
		<div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
			<div>
				<div className="text-sm font-semibold">Run overview</div>
				<div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
					run {runId}
				</div>
			</div>
			<div className="grid grid-cols-2 gap-2">
				{tiles.map((tile) => (
					<div key={tile.label} className="rounded-md border px-2.5 py-2">
						<div className="text-lg font-semibold">{tile.value}</div>
						<div className="text-[11px] text-muted-foreground">
							{tile.label}
						</div>
					</div>
				))}
			</div>
			<KeyValueList items={items} />
			{error && (
				<DetailSection label="Error" tone="error">
					{error}
				</DetailSection>
			)}
			<p className="text-xs text-muted-foreground">
				Pick a step in the timeline or graph to see what it got and returned.
			</p>
		</div>
	);
}

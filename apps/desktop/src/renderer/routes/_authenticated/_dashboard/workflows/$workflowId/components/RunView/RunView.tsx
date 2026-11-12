import type { WorkflowGraph } from "@superset/shared/workflow-graph";
import { Tabs, TabsList, TabsTrigger } from "@superset/ui/tabs";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useNow } from "renderer/hooks/useNow";
import { isActiveRunStatus, runCause } from "../../../utils/runStatus";
import {
	applyRunSteps,
	toCanvasEdges,
	toCanvasNodes,
} from "../../utils/graphMapping";
import { WorkflowCanvas } from "../WorkflowCanvas";
import { WorkflowSidePanel } from "../WorkflowSidePanel";
import { RunBanner } from "./components/RunBanner";
import { RunHeader, type RunVersionInfo } from "./components/RunHeader";
import { RunOverview } from "./components/RunOverview";
import { RunStepPanel } from "./components/RunStepPanel";
import { RunTimeline } from "./components/RunTimeline";
import { MAX_ZOOM, MIN_ZOOM } from "./components/RunTimeline/utils/timeScale";
import { StepStrip } from "./components/StepStrip";
import { TimelineControls } from "./components/TimelineControls";
import { criticalPath, timeInsight } from "./utils/criticalPath";
import { buildRunModel, type RunStep, type RunTimes } from "./utils/runModel";

export interface RunRecord extends RunTimes {
	id: string;
	error: string | null;
	triggerId: string | null;
	eventId: string | null;
	scheduledFor: Date | string | null;
	triggerContext: unknown;
	steps: RunStep[];
}

type RunTab = "timeline" | "graph";

const IGNORE_KEYS_INSIDE =
	"input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='dialog'], [role='menu'], [role='listbox']";

interface RunViewProps {
	run: RunRecord;
	graph: WorkflowGraph;
	version: RunVersionInfo;
	selectedNodeId: string | null;
	/** `reveal: false` selects without switching the side panel away from history. */
	onSelectNode: (nodeId: string | null, reveal?: boolean) => void;
	onCancel: () => void;
	cancelDisabled: boolean;
	onBack: () => void;
	historyPanel: ReactNode | null;
}

export function RunView({
	run,
	graph,
	version,
	selectedNodeId,
	onSelectNode,
	onCancel,
	cancelDisabled,
	onBack,
	historyPanel,
}: RunViewProps) {
	const active = isActiveRunStatus(run.status);
	const now = useNow(1000, active);
	const model = useMemo(
		() => buildRunModel({ graph, run, steps: run.steps, now: now.getTime() }),
		[graph, run, now],
	);
	const cause = runCause({
		triggerKind: run.triggerId || run.eventId ? "event" : null,
		scheduledFor: run.scheduledFor,
	});

	const [tab, setTab] = useState<RunTab>(() => (active ? "graph" : "timeline"));
	const [zoom, setZoom] = useState(MIN_ZOOM);
	const [showCriticalPath, setShowCriticalPath] = useState(false);

	const path = useMemo(
		() => criticalPath(graph, model.timing),
		[graph, model.timing],
	);
	const criticalSet = useMemo(
		() => (showCriticalPath ? new Set(path) : null),
		[showCriticalPath, path],
	);
	const insight =
		run.status === "succeeded" && model.startedMs !== null
			? timeInsight(graph, model.timing, path, model.runEndMs - model.startedMs)
			: null;

	const canvas = useMemo(() => {
		const decorated = applyRunSteps(
			toCanvasNodes(graph),
			toCanvasEdges(graph),
			run.steps,
		);
		return {
			nodes: decorated.nodes.map((node) => ({
				...node,
				selected: node.id === selectedNodeId,
			})),
			edges: decorated.edges,
		};
	}, [graph, run.steps, selectedNodeId]);

	const openedFailedStep = useRef(false);
	useEffect(() => {
		if (openedFailedStep.current) return;
		openedFailedStep.current = true;
		if (!active && model.failedRow && selectedNodeId === null) {
			onSelectNode(model.failedRow.node.id, false);
		}
	}, [active, model.failedRow, selectedNodeId, onSelectNode]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
			if (event.altKey) return;
			if (
				event.target instanceof Element &&
				event.target.closest(IGNORE_KEYS_INSIDE)
			) {
				return;
			}
			const ids = model.rows.map((row) => row.node.id);
			const index = selectedNodeId ? ids.indexOf(selectedNodeId) : -1;
			switch (event.key) {
				case "ArrowDown":
				case "ArrowUp": {
					if (ids.length === 0) return;
					event.preventDefault();
					const down = event.key === "ArrowDown";
					const next =
						index === -1
							? down
								? 0
								: ids.length - 1
							: Math.min(ids.length - 1, Math.max(0, index + (down ? 1 : -1)));
					onSelectNode(ids[next] ?? null);
					return;
				}
				case "Escape":
					if (selectedNodeId) onSelectNode(null);
					return;
				case "f":
				case "F":
					setZoom(MIN_ZOOM);
					return;
				case "g":
				case "G":
					setTab("graph");
					return;
				case "t":
				case "T":
					setTab("timeline");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [model.rows, selectedNodeId, onSelectNode]);

	const selectedRow = selectedNodeId
		? (model.rowsById.get(selectedNodeId) ?? null)
		: null;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<RunHeader
				status={run.status}
				cause={cause}
				model={model}
				version={version}
				onCancel={onCancel}
				cancelDisabled={cancelDisabled}
				onBack={onBack}
			/>
			<RunBanner
				status={run.status}
				runError={run.error}
				model={model}
				insight={insight}
				onShowStep={(nodeId) => onSelectNode(nodeId)}
				onShowCriticalPath={() => {
					setShowCriticalPath(true);
					setTab("timeline");
				}}
			/>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
				<Tabs value={tab} onValueChange={(value) => setTab(value as RunTab)}>
					<TabsList className="h-8">
						<TabsTrigger value="timeline" title="Timeline (T)">
							Timeline
						</TabsTrigger>
						<TabsTrigger value="graph" title="Graph (G)">
							Graph
						</TabsTrigger>
					</TabsList>
				</Tabs>
				<StepStrip model={model} />
				{tab === "timeline" && (
					<TimelineControls
						zoom={zoom}
						onZoomChange={(next) =>
							setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)))
						}
						showCriticalPath={showCriticalPath}
						onShowCriticalPathChange={setShowCriticalPath}
					/>
				)}
			</div>
			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					{tab === "timeline" ? (
						<RunTimeline
							status={run.status}
							model={model}
							selectedNodeId={selectedNodeId}
							onSelectNode={onSelectNode}
							zoom={zoom}
							onZoomChange={setZoom}
							criticalPath={criticalSet}
						/>
					) : (
						<WorkflowCanvas
							nodes={canvas.nodes}
							edges={canvas.edges}
							onNodesChange={() => {}}
							onEdgesChange={() => {}}
							onConnect={() => {}}
							onSelectNode={onSelectNode}
							onAddNode={() => {}}
							readOnly
						/>
					)}
				</div>
				<WorkflowSidePanel>
					{historyPanel ??
						(selectedRow ? (
							<RunStepPanel
								row={selectedRow}
								model={model}
								edges={graph.edges}
								cause={cause}
								scheduledFor={run.scheduledFor}
								triggerContext={run.triggerContext}
							/>
						) : (
							<RunOverview
								runId={run.id}
								cause={cause}
								error={run.error}
								model={model}
								version={version}
							/>
						))}
				</WorkflowSidePanel>
			</div>
		</div>
	);
}

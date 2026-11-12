import type {
	WorkflowGraph,
	WorkflowNode,
} from "@superset/shared/workflow-graph";
import {
	isActiveRunStatus,
	type WorkflowRunStatus,
} from "../../../../../utils/runStatus";
import type { StepStatus } from "../../../../utils/graphMapping";
import { nodeDisplayName } from "../../../../utils/nodeText";
import type { StepTiming } from "../criticalPath";
import { timelineRowOrder } from "../rowOrder";
import { type SkipReason, skipReason } from "../skipReason";
import { waitingOn } from "../waitingOn";

type Timestamp = Date | string | null;

export interface RunStep {
	nodeId: string;
	nodeType: string;
	status: StepStatus;
	input: unknown;
	output: unknown;
	error: string | null;
	attempt: number;
	startedAt: Timestamp;
	finishedAt: Timestamp;
}

export interface RunTimes {
	status: WorkflowRunStatus;
	createdAt: Date | string;
	startedAt: Timestamp;
	finishedAt: Timestamp;
}

export interface TimelineRow extends StepTiming {
	node: WorkflowNode;
	name: string;
	status: StepStatus;
	step: RunStep | null;
	/** End of the dependency that finished last, where the wait line starts. */
	depEndMs: number | null;
	skip: SkipReason | null;
	waitingOn: string[];
}

export type StepCounts = Record<StepStatus, number>;

/** All times are milliseconds since the run was created. */
export interface RunModel {
	rows: TimelineRow[];
	rowsById: ReadonlyMap<string, TimelineRow>;
	timing: ReadonlyMap<string, StepTiming>;
	active: boolean;
	createdAt: number;
	startedMs: number | null;
	queuedMs: number;
	runEndMs: number;
	nowMs: number | null;
	totalMs: number;
	counts: StepCounts;
	failedRow: TimelineRow | null;
	nameOf: (nodeId: string) => string;
}

function toMs(value: Timestamp): number | null {
	if (value === null) return null;
	const ms = new Date(value).getTime();
	return Number.isNaN(ms) ? null : ms;
}

export function buildRunModel({
	graph,
	run,
	steps,
	now,
}: {
	graph: WorkflowGraph;
	run: RunTimes;
	steps: RunStep[];
	now: number;
}): RunModel {
	const active = isActiveRunStatus(run.status);
	const createdAt = toMs(run.createdAt) ?? now;
	const rel = (value: Timestamp) => {
		const ms = toMs(value);
		return ms === null ? null : ms - createdAt;
	};
	const stepsById = new Map(steps.map((step) => [step.nodeId, step]));

	// The desktop clock can lag the server's; never draw "now" before a recorded time.
	const recorded = [
		rel(run.startedAt),
		rel(run.finishedAt),
		...steps.flatMap((step) => [rel(step.startedAt), rel(step.finishedAt)]),
	].filter((ms): ms is number => ms !== null);
	const latestRecorded = Math.max(0, ...recorded);
	const nowMs = active ? Math.max(now - createdAt, latestRecorded) : null;
	const runEndMs = rel(run.finishedAt) ?? nowMs ?? latestRecorded;
	const startedMs = rel(run.startedAt);
	const queuedMs = startedMs ?? runEndMs;

	const statusOf = (nodeId: string): StepStatus => {
		const step = stepsById.get(nodeId);
		if (step) return step.status;
		const node = graph.nodes.find((n) => n.id === nodeId);
		// Older runs wrote no trigger step; any recorded step means it fired.
		return node?.type === "trigger" && steps.length > 0
			? "succeeded"
			: "pending";
	};

	const timing = new Map<string, StepTiming>();
	for (const node of graph.nodes) {
		const step = stepsById.get(node.id);
		const status = statusOf(node.id);
		const startMs = status === "skipped" ? null : rel(step?.startedAt ?? null);
		const endMs =
			startMs === null
				? null
				: (rel(step?.finishedAt ?? null) ??
					(status === "running" ? (nowMs ?? runEndMs) : null));
		timing.set(node.id, { startMs, endMs });
	}

	const nameById = new Map(
		graph.nodes.map((node) => [node.id, nodeDisplayName(node)]),
	);
	const nameOf = (nodeId: string) => nameById.get(nodeId) ?? nodeId;
	const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
	const stepStates = new Map(
		graph.nodes.map((node) => [
			node.id,
			{
				status: statusOf(node.id),
				output: stepsById.get(node.id)?.output ?? null,
			},
		]),
	);

	const order = timelineRowOrder(
		graph,
		(nodeId) => timing.get(nodeId)?.startMs ?? null,
	);
	const rows: TimelineRow[] = order.flatMap((nodeId) => {
		const node = nodeById.get(nodeId);
		if (!node) return [];
		const status = statusOf(nodeId);
		const { startMs, endMs } = timing.get(nodeId) ?? {
			startMs: null,
			endMs: null,
		};
		const depEnds = graph.edges
			.filter((edge) => edge.target === nodeId)
			.map((edge) => timing.get(edge.source)?.endMs ?? null)
			.filter((ms): ms is number => ms !== null);
		return [
			{
				node,
				name: nameOf(nodeId),
				status,
				step: stepsById.get(nodeId) ?? null,
				startMs,
				endMs,
				depEndMs: depEnds.length > 0 ? Math.max(...depEnds) : null,
				skip:
					status === "skipped" ? skipReason(graph, nodeId, stepStates) : null,
				waitingOn:
					status === "pending" ? waitingOn(graph, nodeId, statusOf) : [],
			},
		];
	});

	const counts: StepCounts = {
		pending: 0,
		running: 0,
		succeeded: 0,
		failed: 0,
		skipped: 0,
		canceled: 0,
	};
	for (const row of rows) counts[row.status] += 1;

	const failedRow =
		rows
			.filter((row) => row.status === "failed")
			.sort(
				(a, b) =>
					(a.endMs ?? Number.POSITIVE_INFINITY) -
					(b.endMs ?? Number.POSITIVE_INFINITY),
			)[0] ?? null;

	const rowEnds = rows
		.map((row) => row.endMs)
		.filter((ms): ms is number => ms !== null);
	const totalMs = Math.max(1, runEndMs, ...rowEnds);

	return {
		rows,
		rowsById: new Map(rows.map((row) => [row.node.id, row])),
		timing,
		active,
		createdAt,
		startedMs,
		queuedMs,
		runEndMs,
		nowMs,
		totalMs,
		counts,
		failedRow,
		nameOf,
	};
}

export interface StepTiming {
	startMs: number | null;
	endMs: number | null;
}

interface EdgeGraph {
	edges: { source: string; target: string }[];
}

function sourcesOf(graph: EdgeGraph, nodeId: string): string[] {
	return graph.edges
		.filter((edge) => edge.target === nodeId)
		.map((edge) => edge.source);
}

/**
 * The chain of steps that set the total duration: start at the step that
 * ended last, then keep following the dependency that ended last.
 */
export function criticalPath(
	graph: EdgeGraph,
	timing: ReadonlyMap<string, StepTiming>,
): string[] {
	const endOf = (nodeId: string) => timing.get(nodeId)?.endMs ?? null;
	let current: string | null = null;
	for (const [nodeId, { endMs }] of timing) {
		if (endMs === null) continue;
		const currentEnd = current === null ? null : endOf(current);
		if (currentEnd === null || endMs > currentEnd) current = nodeId;
	}
	const path: string[] = [];
	while (current !== null && !path.includes(current)) {
		path.push(current);
		let next: string | null = null;
		for (const source of sourcesOf(graph, current)) {
			const end = endOf(source);
			if (end === null) continue;
			const nextEnd = next === null ? null : endOf(next);
			if (nextEnd === null || end > nextEnd) next = source;
		}
		current = next;
	}
	return path.reverse();
}

export interface TimeInsight {
	nodeId: string;
	durationMs: number;
	share: number;
	/** A parallel step that finished first and then waited for this one. */
	waited: { nodeId: string; endMs: number } | null;
}

export function timeInsight(
	graph: EdgeGraph,
	timing: ReadonlyMap<string, StepTiming>,
	path: string[],
	totalMs: number,
): TimeInsight | null {
	if (totalMs <= 0) return null;
	let longest: { nodeId: string; durationMs: number; endMs: number } | null =
		null;
	for (const nodeId of path) {
		const step = timing.get(nodeId);
		if (step?.startMs == null || step.endMs == null) continue;
		const durationMs = step.endMs - step.startMs;
		if (!longest || durationMs > longest.durationMs) {
			longest = { nodeId, durationMs, endMs: step.endMs };
		}
	}
	if (!longest) return null;
	const dominant = longest;

	const child = path[path.indexOf(dominant.nodeId) + 1];
	let waited: TimeInsight["waited"] = null;
	if (child) {
		for (const source of sourcesOf(graph, child)) {
			const endMs = timing.get(source)?.endMs;
			if (source === dominant.nodeId || endMs == null) continue;
			if (endMs < dominant.endMs && (!waited || endMs > waited.endMs)) {
				waited = { nodeId: source, endMs };
			}
		}
	}
	return {
		nodeId: dominant.nodeId,
		durationMs: dominant.durationMs,
		share: dominant.durationMs / totalMs,
		waited,
	};
}

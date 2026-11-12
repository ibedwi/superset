import type { StepStatus } from "../../../../utils/graphMapping";

const DONE: ReadonlySet<StepStatus> = new Set(["succeeded", "skipped"]);

/** The upstream steps a pending step still needs before the engine can start it. */
export function waitingOn(
	graph: { edges: { source: string; target: string }[] },
	nodeId: string,
	statusOf: (nodeId: string) => StepStatus,
): string[] {
	const sources = graph.edges
		.filter((edge) => edge.target === nodeId)
		.map((edge) => edge.source);
	return [...new Set(sources)].filter((source) => !DONE.has(statusOf(source)));
}

import type { StepStatus } from "../../../../utils/graphMapping";

export interface SkipGraph {
	nodes: { id: string; type: string }[];
	edges: { source: string; target: string; sourceHandle?: "true" | "false" }[];
}

export type SkipReason =
	| {
			kind: "branch";
			conditionId: string;
			result: boolean;
			branch: "true" | "false";
	  }
	| { kind: "upstream"; upstreamId: string }
	| { kind: "unknown" };

export const BRANCH_LABELS = { true: "Yes", false: "No" } as const;

export function conditionResult(output: unknown): boolean | null {
	if (typeof output !== "object" || output === null) return null;
	const result = (output as { result?: unknown }).result;
	return typeof result === "boolean" ? result : null;
}

/**
 * The engine records only `skipped`. The cause is a condition that took the
 * other branch, or an upstream step that was itself skipped.
 */
export function skipReason(
	graph: SkipGraph,
	nodeId: string,
	steps: ReadonlyMap<string, { status: StepStatus; output: unknown }>,
): SkipReason {
	const incoming = graph.edges.filter((edge) => edge.target === nodeId);
	for (const edge of incoming) {
		const source = graph.nodes.find((node) => node.id === edge.source);
		if (source?.type !== "condition" || !edge.sourceHandle) continue;
		const result = conditionResult(steps.get(source.id)?.output);
		if (result !== null && String(result) !== edge.sourceHandle) {
			return {
				kind: "branch",
				conditionId: source.id,
				result,
				branch: edge.sourceHandle,
			};
		}
	}
	const skippedSource = incoming.find(
		(edge) => steps.get(edge.source)?.status === "skipped",
	);
	if (skippedSource)
		return { kind: "upstream", upstreamId: skippedSource.source };
	return { kind: "unknown" };
}

export function skipReasonText(
	reason: SkipReason,
	nameOf: (nodeId: string) => string,
): string | null {
	switch (reason.kind) {
		case "branch":
			return `${nameOf(reason.conditionId)} answered ${BRANCH_LABELS[String(reason.result) as "true" | "false"]}, this step is on the ${BRANCH_LABELS[reason.branch]} branch`;
		case "upstream":
			return `${nameOf(reason.upstreamId)} was skipped`;
		case "unknown":
			return null;
	}
}

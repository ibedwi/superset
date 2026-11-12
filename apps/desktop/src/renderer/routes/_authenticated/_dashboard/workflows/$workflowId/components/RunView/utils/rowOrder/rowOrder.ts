export interface OrderGraph {
	nodes: { id: string }[];
	edges: { source: string; target: string }[];
}

/** Longest path from a root, so every node sits below all of its dependencies. */
export function nodeDepths(graph: OrderGraph): Map<string, number> {
	const incoming = new Map<string, string[]>();
	for (const edge of graph.edges) {
		incoming.set(edge.target, [
			...(incoming.get(edge.target) ?? []),
			edge.source,
		]);
	}
	const depths = new Map<string, number>();
	const visiting = new Set<string>();
	const depthOf = (nodeId: string): number => {
		const known = depths.get(nodeId);
		if (known !== undefined) return known;
		if (visiting.has(nodeId)) return 0;
		visiting.add(nodeId);
		const sources = incoming.get(nodeId) ?? [];
		const depth =
			sources.length === 0 ? 0 : 1 + Math.max(...sources.map(depthOf));
		visiting.delete(nodeId);
		depths.set(nodeId, depth);
		return depth;
	};
	for (const node of graph.nodes) depthOf(node.id);
	return depths;
}

/**
 * Graph order: by depth, then by start time, then by position in the graph.
 * A started step never moves, because later starts sort after it.
 */
export function timelineRowOrder(
	graph: OrderGraph,
	startOf: (nodeId: string) => number | null,
): string[] {
	const depths = nodeDepths(graph);
	const index = new Map(graph.nodes.map((node, i) => [node.id, i]));
	const start = (nodeId: string) => startOf(nodeId) ?? Number.POSITIVE_INFINITY;
	return graph.nodes
		.map((node) => node.id)
		.sort((a, b) => {
			const byDepth = (depths.get(a) ?? 0) - (depths.get(b) ?? 0);
			if (byDepth !== 0) return byDepth;
			const startA = start(a);
			const startB = start(b);
			if (startA !== startB) return startA < startB ? -1 : 1;
			return (index.get(a) ?? 0) - (index.get(b) ?? 0);
		});
}

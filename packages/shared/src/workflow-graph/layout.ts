export const LAYOUT_RANK_GAP = 240;
export const LAYOUT_SIBLING_GAP = 320;

type LayoutNode = { id: string; position: { x: number; y: number } };
type LayoutEdge = { source: string; target: string; sourceHandle?: string };

const BRANCH_ORDER: Record<string, number> = { true: 0, false: 2 };

/**
 * Places nodes top to bottom: the rank is the longest path from a root, and
 * nodes in one rank sit side by side, centered on x = 0. A condition's "true"
 * branch goes left of its "false" branch to match the card's handles. Nodes on
 * a cycle go to one extra rank so they stay visible.
 */
export function layoutWorkflowGraph<
	G extends { nodes: LayoutNode[]; edges: LayoutEdge[] },
>(graph: G): G {
	const ids = new Set(graph.nodes.map((node) => node.id));
	const edges = graph.edges.filter(
		(edge) => ids.has(edge.source) && ids.has(edge.target),
	);
	const indegree = new Map<string, number>(
		graph.nodes.map((node) => [node.id, 0]),
	);
	const out = new Map<string, string[]>();
	const branchOrder = new Map<string, number>();
	for (const edge of edges) {
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
		if (edge.sourceHandle !== undefined && !branchOrder.has(edge.target))
			branchOrder.set(edge.target, BRANCH_ORDER[edge.sourceHandle] ?? 1);
	}

	const rank = new Map<string, number>();
	const ready = graph.nodes
		.filter((node) => indegree.get(node.id) === 0)
		.map((node) => node.id);
	for (const id of ready) rank.set(id, 0);
	for (let id = ready.shift(); id !== undefined; id = ready.shift()) {
		const next = (rank.get(id) ?? 0) + 1;
		for (const target of out.get(id) ?? []) {
			rank.set(target, Math.max(rank.get(target) ?? 0, next));
			const remaining = (indegree.get(target) ?? 0) - 1;
			indegree.set(target, remaining);
			if (remaining === 0) ready.push(target);
		}
	}

	const placed = graph.nodes.filter((node) => indegree.get(node.id) === 0);
	const cycleRank =
		placed.reduce((max, node) => Math.max(max, rank.get(node.id) ?? 0), -1) + 1;
	const rankOf = (id: string) =>
		indegree.get(id) === 0 ? (rank.get(id) ?? 0) : cycleRank;

	const ranks = new Map<number, string[]>();
	for (const node of graph.nodes) {
		const index = rankOf(node.id);
		ranks.set(index, [...(ranks.get(index) ?? []), node.id]);
	}
	const positions = new Map<string, { x: number; y: number }>();
	for (const [index, members] of ranks) {
		const ordered = members
			.map((id, order) => ({ id, order }))
			.sort(
				(a, b) =>
					(branchOrder.get(a.id) ?? 1) - (branchOrder.get(b.id) ?? 1) ||
					a.order - b.order,
			);
		ordered.forEach(({ id }, column) => {
			positions.set(id, {
				x: (column - (ordered.length - 1) / 2) * LAYOUT_SIBLING_GAP,
				y: index * LAYOUT_RANK_GAP,
			});
		});
	}

	return {
		...graph,
		nodes: graph.nodes.map((node) => ({
			...node,
			position: positions.get(node.id) ?? node.position,
		})),
	};
}

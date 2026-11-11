import type { WorkflowEdge, WorkflowGraph } from "./schema";

/**
 * Structural validation and a deterministic topological iterator.
 *
 * Pure on purpose: the Temporal workflow bundle imports this directly, so it
 * must stay free of I/O, Date, and randomness, and iteration order must be
 * identical on every replay.
 */

export type GraphProblem =
	| { kind: "no_trigger" }
	| { kind: "multiple_triggers"; nodeIds: string[] }
	| { kind: "duplicate_node_id"; nodeId: string }
	| { kind: "unknown_edge_endpoint"; edgeId: string; nodeId: string }
	| { kind: "edge_into_trigger"; edgeId: string }
	| { kind: "missing_condition_handle"; edgeId: string }
	| { kind: "handle_on_non_condition"; edgeId: string }
	| { kind: "cycle"; nodeIds: string[] }
	| { kind: "unreachable"; nodeIds: string[] };

export function validateGraph(graph: WorkflowGraph): GraphProblem[] {
	const problems: GraphProblem[] = [];
	const seen = new Set<string>();
	for (const node of graph.nodes) {
		if (seen.has(node.id)) problems.push({ kind: "duplicate_node_id", nodeId: node.id });
		seen.add(node.id);
	}

	const byId = new Map(graph.nodes.map((n) => [n.id, n]));
	const triggers = graph.nodes.filter((n) => n.type === "trigger");
	if (triggers.length === 0) problems.push({ kind: "no_trigger" });
	if (triggers.length > 1)
		problems.push({ kind: "multiple_triggers", nodeIds: triggers.map((n) => n.id) });

	for (const edge of graph.edges) {
		for (const endpoint of [edge.source, edge.target]) {
			if (!byId.has(endpoint))
				problems.push({ kind: "unknown_edge_endpoint", edgeId: edge.id, nodeId: endpoint });
		}
		const source = byId.get(edge.source);
		const target = byId.get(edge.target);
		if (target?.type === "trigger") problems.push({ kind: "edge_into_trigger", edgeId: edge.id });
		if (source?.type === "condition" && !edge.sourceHandle)
			problems.push({ kind: "missing_condition_handle", edgeId: edge.id });
		if (source && source.type !== "condition" && edge.sourceHandle)
			problems.push({ kind: "handle_on_non_condition", edgeId: edge.id });
	}
	if (problems.length > 0) return problems;

	const order = topologicalOrder(graph);
	if (order === null) {
		problems.push({ kind: "cycle", nodeIds: nodesInCycle(graph) });
		return problems;
	}

	const reachable = reachableFrom(triggers[0]!.id, graph.edges);
	const unreachable = graph.nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id);
	if (unreachable.length > 0) problems.push({ kind: "unreachable", nodeIds: unreachable });
	return problems;
}

/**
 * Kahn's algorithm with the ready set kept sorted by node id, so the order is
 * a pure function of the graph. Returns null when the graph has a cycle.
 */
export function topologicalOrder(graph: WorkflowGraph): string[] | null {
	const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
	const out = new Map<string, string[]>();
	for (const edge of graph.edges) {
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		const list = out.get(edge.source) ?? [];
		list.push(edge.target);
		out.set(edge.source, list);
	}
	const ready = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
	ready.sort();
	const order: string[] = [];
	while (ready.length > 0) {
		const id = ready.shift()!;
		order.push(id);
		for (const next of (out.get(id) ?? []).slice().sort()) {
			const d = indegree.get(next)! - 1;
			indegree.set(next, d);
			if (d === 0) {
				ready.push(next);
				ready.sort();
			}
		}
	}
	return order.length === graph.nodes.length ? order : null;
}

function nodesInCycle(graph: WorkflowGraph): string[] {
	const order = new Set(partialOrder(graph));
	return graph.nodes.filter((n) => !order.has(n.id)).map((n) => n.id);
}

function partialOrder(graph: WorkflowGraph): string[] {
	const indegree = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
	const out = new Map<string, string[]>();
	for (const edge of graph.edges) {
		indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
		(out.get(edge.source) ?? out.set(edge.source, []).get(edge.source)!).push(edge.target);
	}
	const ready = [...indegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);
	const order: string[] = [];
	while (ready.length > 0) {
		const id = ready.shift()!;
		order.push(id);
		for (const next of out.get(id) ?? []) {
			const d = indegree.get(next)! - 1;
			indegree.set(next, d);
			if (d === 0) ready.push(next);
		}
	}
	return order;
}

function reachableFrom(start: string, edges: WorkflowEdge[]): Set<string> {
	const out = new Map<string, string[]>();
	for (const edge of edges) {
		const list = out.get(edge.source) ?? [];
		list.push(edge.target);
		out.set(edge.source, list);
	}
	const seen = new Set<string>([start]);
	const stack = [start];
	while (stack.length > 0) {
		const id = stack.pop()!;
		for (const next of out.get(id) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				stack.push(next);
			}
		}
	}
	return seen;
}

export function incomingEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
	return graph.edges.filter((e) => e.target === nodeId);
}

export function outgoingEdges(graph: WorkflowGraph, nodeId: string): WorkflowEdge[] {
	return graph.edges.filter((e) => e.source === nodeId);
}

/**
 * All nodes only reachable through the given edge set — used to mark the
 * untaken branch of a condition as skipped. A node survives if any path from
 * the trigger avoids the dropped edges.
 */
export function subtreeBehindEdges(graph: WorkflowGraph, droppedEdgeIds: Set<string>): string[] {
	const trigger = graph.nodes.find((n) => n.type === "trigger");
	if (!trigger) return [];
	const kept = graph.edges.filter((e) => !droppedEdgeIds.has(e.id));
	const reachable = reachableFrom(trigger.id, kept);
	return graph.nodes.filter((n) => !reachable.has(n.id)).map((n) => n.id);
}

import type {
	DraftWorkflowGraph,
	DraftWorkflowNode,
	WorkflowNodeType,
} from "@superset/shared/workflow-graph";
import type { Edge, Node, Viewport } from "@xyflow/react";

export type CanvasNodeData = { wf: DraftWorkflowNode };
export type CanvasNode = Node<CanvasNodeData>;
export type CanvasEdge = Edge;

export function toCanvasNodes(graph: DraftWorkflowGraph): CanvasNode[] {
	return graph.nodes.map((node) => ({
		id: node.id,
		type: node.type,
		position: node.position,
		data: { wf: node },
	}));
}

export function toCanvasEdges(graph: DraftWorkflowGraph): CanvasEdge[] {
	return graph.edges.map((edge) => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: edge.sourceHandle ?? undefined,
	}));
}

export function fromCanvas(
	nodes: CanvasNode[],
	edges: CanvasEdge[],
	viewport?: Viewport,
): DraftWorkflowGraph {
	return {
		nodes: nodes.map((node) => ({
			...node.data.wf,
			position: { x: node.position.x, y: node.position.y },
		})),
		edges: edges.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			...(edge.sourceHandle === "true" || edge.sourceHandle === "false"
				? { sourceHandle: edge.sourceHandle }
				: {}),
		})),
		...(viewport ? { viewport } : {}),
	};
}

/** Slug ids are referenced by templates, so they must be unique and stable. */
export function nextNodeId(
	type: WorkflowNodeType,
	existingIds: Iterable<string>,
): string {
	const taken = new Set(existingIds);
	if (!taken.has(type)) return type;
	for (let n = 2; ; n++) {
		const candidate = `${type}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

export function defaultNodeConfig(
	type: WorkflowNodeType,
): DraftWorkflowNode["config"] {
	switch (type) {
		case "trigger":
			return {};
		case "agent":
			return { agent: "", prompt: "", timeoutMinutes: 120 };
		case "llm":
			return { prompt: "", model: "", maxTokens: 4096 };
		case "http":
			return { method: "GET", url: "", headers: {}, timeoutSeconds: 30 };
		case "condition":
			return {};
		case "cli":
			return { command: "", timeoutMinutes: 30 };
	}
}

export function createNode(
	type: WorkflowNodeType,
	existingIds: Iterable<string>,
	position: { x: number; y: number },
): CanvasNode {
	const id = nextNodeId(type, existingIds);
	const wf = {
		id,
		type,
		position,
		config: defaultNodeConfig(type),
	} as DraftWorkflowNode;
	return { id, type, position, data: { wf } };
}

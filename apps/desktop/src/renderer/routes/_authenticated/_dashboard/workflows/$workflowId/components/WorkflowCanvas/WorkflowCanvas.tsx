import "@xyflow/react/dist/style.css";
import type { WorkflowNodeType } from "@superset/shared/workflow-graph";
import { Button } from "@superset/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@superset/ui/dropdown-menu";
import {
	Background,
	type Connection,
	Controls,
	type EdgeChange,
	type NodeChange,
	Panel,
	ReactFlow,
} from "@xyflow/react";
import { useCallback } from "react";
import { LuNetwork, LuPlus } from "react-icons/lu";
import type { CanvasEdge, CanvasNode } from "../../utils/graphMapping";
import { WorkflowNodeCard } from "./components/WorkflowNodeCard";

const nodeTypes = {
	trigger: WorkflowNodeCard,
	agent: WorkflowNodeCard,
	llm: WorkflowNodeCard,
	http: WorkflowNodeCard,
	condition: WorkflowNodeCard,
	cli: WorkflowNodeCard,
};

const ADDABLE_TYPES: {
	type: Exclude<WorkflowNodeType, "trigger">;
	label: React.ReactNode;
}[] = [
	{ type: "agent", label: "Agent" },
	{ type: "llm", label: "LLM" },
	{ type: "http", label: "HTTP request" },
	{ type: "condition", label: "Condition" },
	{ type: "cli", label: "Command" },
];

interface WorkflowCanvasProps {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
	onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
	onConnect: (connection: Connection) => void;
	onSelectNode: (nodeId: string | null) => void;
	onAddNode: (type: Exclude<WorkflowNodeType, "trigger">) => void;
	onArrange?: () => void;
	readOnly: boolean;
}

export function WorkflowCanvas({
	nodes,
	edges,
	onNodesChange,
	onEdgesChange,
	onConnect,
	onSelectNode,
	onAddNode,
	onArrange,
	readOnly,
}: WorkflowCanvasProps) {
	const isValidConnection = useCallback(
		(connection: CanvasEdge | Connection) => {
			if (connection.source === connection.target) return false;
			const target = nodes.find((node) => node.id === connection.target);
			if (!target || target.data.wf.type === "trigger") return false;
			return !edges.some(
				(edge) =>
					edge.source === connection.source &&
					edge.target === connection.target &&
					(edge.sourceHandle ?? null) === (connection.sourceHandle ?? null),
			);
		},
		[nodes, edges],
	);

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			nodeTypes={nodeTypes}
			onNodesChange={onNodesChange}
			onEdgesChange={onEdgesChange}
			onConnect={onConnect}
			isValidConnection={isValidConnection}
			onNodeClick={(_, node) => onSelectNode(node.id)}
			onPaneClick={() => onSelectNode(null)}
			nodesDraggable={!readOnly}
			nodesConnectable={!readOnly}
			elementsSelectable
			deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
			fitView
			colorMode="system"
			proOptions={{ hideAttribution: true }}
		>
			<Background gap={16} />
			<Controls showInteractive={false} />
			{!readOnly && (
				<Panel position="top-left" className="flex gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button size="sm" variant="secondary">
								<LuPlus className="size-3.5" />
								Add node
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start">
							{ADDABLE_TYPES.map(({ type, label }) => (
								<DropdownMenuItem key={type} onSelect={() => onAddNode(type)}>
									{label}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
					{onArrange && (
						<Button size="sm" variant="secondary" onClick={onArrange}>
							<LuNetwork className="size-3.5" />
							Arrange
						</Button>
					)}
				</Panel>
			)}
		</ReactFlow>
	);
}

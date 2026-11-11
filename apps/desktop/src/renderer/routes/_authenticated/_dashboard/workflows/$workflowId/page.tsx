import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { i18n } from "@superset/i18n";
import { errorMessage } from "@superset/i18n/errors";
import {
	type DraftWorkflowNode,
	type GraphProblem,
	validateGraph,
	workflowGraphSchema,
} from "@superset/shared/workflow-graph";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@superset/ui/alert-dialog";
import { Button } from "@superset/ui/button";
import { toast } from "@superset/ui/sonner";
import { Switch } from "@superset/ui/switch";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TRPCClientError } from "@trpc/client";
import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	type Connection,
	type EdgeChange,
	type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuChevronLeft, LuPlay, LuSave } from "react-icons/lu";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { authClient } from "renderer/lib/auth-client";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { EditableTitle } from "renderer/routes/_authenticated/_dashboard/components/EditableTitle";
import { NodeConfigPanel } from "./components/NodeConfigPanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import {
	type CanvasEdge,
	type CanvasNode,
	createNode,
	fromCanvas,
	toCanvasEdges,
	toCanvasNodes,
} from "./utils/graphMapping";

export const Route = createFileRoute(
	"/_authenticated/_dashboard/workflows/$workflowId/",
)({
	component: WorkflowEditorPage,
});

const EMPTY_GRAPH = {
	nodes: [
		{
			id: "trigger",
			type: "trigger",
			position: { x: 0, y: 0 },
			config: {},
		} satisfies DraftWorkflowNode,
	],
	edges: [],
};

function problemText(problem: GraphProblem): string {
	switch (problem.kind) {
		case "no_trigger":
			return i18n._(msg({ message: "The graph needs a trigger node." }));
		case "multiple_triggers":
			return i18n._(msg({ message: "Only one trigger node is allowed." }));
		case "duplicate_node_id": {
			const nodeId = problem.nodeId;
			return i18n._(msg({ message: `Duplicate node id: ${nodeId}` }));
		}
		case "unknown_edge_endpoint":
			return i18n._(msg({ message: "An edge points at a missing node." }));
		case "edge_into_trigger":
			return i18n._(msg({ message: "Edges cannot point into the trigger." }));
		case "missing_condition_handle":
			return i18n._(
				msg({
					message: "Connect condition branches from their yes/no handles.",
				}),
			);
		case "handle_on_non_condition":
			return i18n._(
				msg({ message: "Only condition nodes have branch handles." }),
			);
		case "cycle": {
			const nodeIds = problem.nodeIds.join(", ");
			return i18n._(
				msg({ message: `The graph has a cycle through: ${nodeIds}` }),
			);
		}
		case "unreachable": {
			const nodeIds = problem.nodeIds.join(", ");
			return i18n._(msg({ message: `Unreachable nodes: ${nodeIds}` }));
		}
	}
}

function WorkflowEditorPage() {
	const { t } = useLingui();
	const { workflowId } = Route.useParams();
	const { data: session } = authClient.useSession();
	const utils = cloudTrpc.useUtils();

	const workflowQuery = cloudTrpc.workflow.get.useQuery({ id: workflowId });
	const workflow = workflowQuery.data;

	const [nodes, setNodes] = useState<CanvasNode[]>([]);
	const [edges, setEdges] = useState<CanvasEdge[]>([]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const [dirty, setDirty] = useState(false);
	const [conflictOpen, setConflictOpen] = useState(false);
	// The version the loaded graph was built on; saves race against it.
	const expectedVersionRef = useRef(0);
	const loadedWorkflowRef = useRef<string | null>(null);

	useEffect(() => {
		if (!workflow) return;
		// Only seed once per workflow; later refetches must not clobber edits.
		if (loadedWorkflowRef.current === workflow.id) return;
		loadedWorkflowRef.current = workflow.id;
		const graph = workflow.liveGraph?.graph ?? EMPTY_GRAPH;
		setNodes(toCanvasNodes(graph));
		setEdges(toCanvasEdges(graph));
		expectedVersionRef.current = workflow.headVersion;
		setDirty(false);
	}, [workflow]);

	const readOnly =
		session?.user?.id !== undefined &&
		workflow !== undefined &&
		workflow.ownerUserId !== session.user.id;

	const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
		setNodes((current) => applyNodeChanges(changes, current));
		if (
			changes.some(
				(change) => change.type !== "select" && change.type !== "dimensions",
			)
		) {
			setDirty(true);
		}
	}, []);

	const onEdgesChange = useCallback((changes: EdgeChange<CanvasEdge>[]) => {
		setEdges((current) => applyEdgeChanges(changes, current));
		if (changes.some((change) => change.type !== "select")) setDirty(true);
	}, []);

	const onConnect = useCallback((connection: Connection) => {
		setEdges((current) =>
			addEdge(
				{
					...connection,
					id: `${connection.source}-${connection.sourceHandle ?? "out"}-${connection.target}`,
				},
				current,
			),
		);
		setDirty(true);
	}, []);

	const onAddNode = useCallback((type: Parameters<typeof createNode>[0]) => {
		setNodes((current) => {
			const last = current.at(-1);
			const position = last
				? { x: last.position.x + 280, y: last.position.y }
				: { x: 0, y: 0 };
			const node = createNode(
				type,
				current.map((n) => n.id),
				position,
			);
			return [...current, node];
		});
		setDirty(true);
	}, []);

	const onChangeNode = useCallback((nodeId: string, wf: DraftWorkflowNode) => {
		setNodes((current) =>
			current.map((node) =>
				node.id === nodeId ? { ...node, data: { wf } } : node,
			),
		);
		setDirty(true);
	}, []);

	const onDeleteNode = useCallback((nodeId: string) => {
		setNodes((current) => current.filter((node) => node.id !== nodeId));
		setEdges((current) =>
			current.filter(
				(edge) => edge.source !== nodeId && edge.target !== nodeId,
			),
		);
		setSelectedNodeId(null);
		setDirty(true);
	}, []);

	const saveMutation = useMutation({
		mutationFn: (graph: unknown) =>
			apiTrpcClient.workflow.saveGraph.mutate({
				workflowId,
				graph,
				expectedVersion: expectedVersionRef.current,
			}),
		onSuccess: (saved) => {
			expectedVersionRef.current = saved.headVersion;
			setDirty(false);
			void utils.workflow.get.invalidate({ id: workflowId });
			toast.success(t({ message: "Workflow saved" }));
		},
		onError: (error) => {
			if (error instanceof TRPCClientError && error.data?.code === "CONFLICT") {
				setConflictOpen(true);
				return;
			}
			toast.error(
				errorMessage(error, t({ message: "Failed to save workflow" })),
			);
		},
	});

	const save = useCallback(() => {
		if (readOnly || saveMutation.isPending) return;
		const graph = fromCanvas(nodes, edges);
		const parsed = workflowGraphSchema.safeParse(graph);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			toast.error(
				t({ message: "Fix the graph before saving" }) +
					(issue ? `: ${issue.path.join(".")} ${issue.message}` : ""),
			);
			return;
		}
		const problems = validateGraph(parsed.data);
		if (problems.length > 0) {
			toast.error(problems.map(problemText).join(" "));
			return;
		}
		saveMutation.mutate(parsed.data);
	}, [nodes, edges, readOnly, saveMutation, t]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key === "s") {
				event.preventDefault();
				save();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [save]);

	const reloadLatest = useCallback(() => {
		loadedWorkflowRef.current = null;
		setConflictOpen(false);
		setSelectedNodeId(null);
		void workflowQuery.refetch();
	}, [workflowQuery]);

	// Keeping local edits adopts the server's head version, so the next save
	// writes a new version on top of it instead of conflicting forever.
	const keepEditing = useCallback(async () => {
		const latest = await utils.workflow.get
			.fetch({ id: workflowId })
			.catch(() => null);
		if (latest) expectedVersionRef.current = latest.headVersion;
	}, [utils, workflowId]);

	const renameMutation = useMutation({
		mutationFn: (name: string) =>
			apiTrpcClient.workflow.update.mutate({ id: workflowId, name }),
		onSuccess: () => {
			void utils.workflow.get.invalidate({ id: workflowId });
			void utils.workflow.list.invalidate();
		},
	});

	const setEnabledMutation = useMutation({
		mutationFn: (enabled: boolean) =>
			apiTrpcClient.workflow.update.mutate({ id: workflowId, enabled }),
		onSuccess: () => {
			void utils.workflow.get.invalidate({ id: workflowId });
			void utils.workflow.list.invalidate();
		},
		onError: (error) =>
			toast.error(
				errorMessage(error, t({ message: "Failed to update workflow" })),
			),
	});

	const runNowMutation = useMutation({
		mutationFn: () => apiTrpcClient.workflow.runNow.mutate({ workflowId }),
		onSuccess: () => toast.success(t({ message: "Running now" })),
		onError: (error) =>
			toast.error(errorMessage(error, t({ message: "Failed to start run" }))),
	});

	if (!workflow) {
		if (workflowQuery.isPending) return null;
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				<Trans>Workflow not found.</Trans>
			</div>
		);
	}

	const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div className="flex items-center gap-3 border-b px-4 py-2">
				<Button asChild variant="ghost" size="icon-sm">
					<Link
						to="/workflows"
						aria-label={t({ message: "Back to workflows" })}
					>
						<LuChevronLeft className="size-4" />
					</Link>
				</Button>
				<div className="min-w-0 flex-1">
					<EditableTitle
						name={workflow.name}
						label={t({ message: "Workflow name" })}
						maxLength={200}
						onRename={(name) => renameMutation.mutate(name)}
					/>
				</div>
				<div className="flex items-center gap-2">
					<Switch
						checked={workflow.enabled}
						onCheckedChange={(enabled) => setEnabledMutation.mutate(enabled)}
						disabled={readOnly || setEnabledMutation.isPending}
						aria-label={t({ message: "Enabled" })}
					/>
					<Button
						variant="outline"
						size="sm"
						onClick={() => runNowMutation.mutate()}
						disabled={runNowMutation.isPending || !workflow.liveVersionId}
					>
						<LuPlay className="size-3.5" />
						<Trans>Run now</Trans>
					</Button>
					<Button
						size="sm"
						onClick={save}
						disabled={readOnly || !dirty || saveMutation.isPending}
					>
						<LuSave className="size-3.5" />
						<Trans>Save</Trans>
					</Button>
				</div>
			</div>

			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					<WorkflowCanvas
						nodes={nodes}
						edges={edges}
						onNodesChange={onNodesChange}
						onEdgesChange={onEdgesChange}
						onConnect={onConnect}
						onSelectNode={setSelectedNodeId}
						onAddNode={onAddNode}
						readOnly={readOnly}
					/>
				</div>
				<div className="w-80 shrink-0 border-l">
					<NodeConfigPanel
						workflowId={workflowId}
						node={selectedNode}
						onChangeNode={onChangeNode}
						onDeleteNode={onDeleteNode}
						readOnly={readOnly}
					/>
				</div>
			</div>

			<AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Workflow changed elsewhere</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>
								Someone saved a newer version of this workflow. Reload to get
								their changes, or keep editing and save again to retry on top of
								your copy.
							</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => void keepEditing()}>
							<Trans>Keep editing</Trans>
						</AlertDialogCancel>
						<AlertDialogAction onClick={reloadLatest}>
							<Trans>Reload latest</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

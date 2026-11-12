import { errorMessage } from "@superset/i18n/errors";
import {
	formatCompactRelativeTime,
	formatElapsed,
} from "@superset/i18n/format";
import {
	type DraftWorkflowNode,
	type GraphProblem,
	LAYOUT_RANK_GAP,
	layoutWorkflowGraph,
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
import { cn } from "@superset/ui/utils";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	LuChevronLeft,
	LuCircleStop,
	LuHistory,
	LuPlay,
	LuSave,
	LuSparkles,
	LuX,
} from "react-icons/lu";
import { useNow } from "renderer/hooks/useNow";
import { apiTrpcClient } from "renderer/lib/api-trpc-client";
import { authClient } from "renderer/lib/auth-client";
import { cloudTrpc } from "renderer/lib/cloud-trpc";
import { EditableTitle } from "renderer/routes/_authenticated/_dashboard/components/EditableTitle";
import { ResizablePanel } from "renderer/screens/main/components/ResizablePanel";
import {
	type GeneratedWorkflow,
	GenerateWorkflowDialog,
} from "../components/GenerateWorkflowDialog";
import { usePendingWorkflowDraftStore } from "../stores/pendingWorkflowDraftStore";
import { isActiveRunStatus, RUN_STATUS_META } from "../utils/runStatus";
import { NodeConfigPanel } from "./components/NodeConfigPanel";
import { RunStepPanel, type RunStepRow } from "./components/RunStepPanel";
import { RunsPanel } from "./components/RunsPanel";
import { WorkflowCanvas } from "./components/WorkflowCanvas";
import {
	DEFAULT_WORKFLOW_SIDE_PANEL_WIDTH,
	MAX_WORKFLOW_SIDE_PANEL_WIDTH,
	MIN_WORKFLOW_SIDE_PANEL_WIDTH,
	useWorkflowSidePanelStore,
} from "./stores/workflowSidePanelStore";
import {
	applyRunSteps,
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
	validateSearch: (search: Record<string, unknown>): { runId?: string } =>
		typeof search.runId === "string" ? { runId: search.runId } : {},
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
			return "The graph needs a trigger node.";
		case "multiple_triggers":
			return "Only one trigger node is allowed.";
		case "duplicate_node_id": {
			const nodeId = problem.nodeId;
			return `Duplicate node id: ${nodeId}`;
		}
		case "unknown_edge_endpoint":
			return "An edge points at a missing node.";
		case "edge_into_trigger":
			return "Edges cannot point into the trigger.";
		case "missing_condition_handle":
			return "Connect condition branches from their yes/no handles.";
		case "handle_on_non_condition":
			return "Only condition nodes have branch handles.";
		case "cycle": {
			const nodeIds = problem.nodeIds.join(", ");
			return `The graph has a cycle through: ${nodeIds}`;
		}
		case "unreachable": {
			const nodeIds = problem.nodeIds.join(", ");
			return `Unreachable nodes: ${nodeIds}`;
		}
	}
}

function WorkflowEditorPage() {
	const { workflowId } = Route.useParams();
	const { runId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const { data: session } = authClient.useSession();
	const utils = cloudTrpc.useUtils();
	const now = useNow(10_000);

	const workflowQuery = cloudTrpc.workflow.get.useQuery({ id: workflowId });
	const workflow = workflowQuery.data;

	const [panelTab, setPanelTab] = useState<"config" | "runs">("config");
	const sidePanelWidth = useWorkflowSidePanelStore((s) => s.width);
	const setSidePanelWidth = useWorkflowSidePanelStore((s) => s.setWidth);

	const runQuery = cloudTrpc.workflow.getRun.useQuery(
		{ runId: runId ?? "" },
		{
			enabled: !!runId,
			refetchInterval: (query) => {
				const status = query.state.data?.status;
				return status === undefined || isActiveRunStatus(status) ? 2000 : false;
			},
		},
	);
	const run = runId ? runQuery.data : undefined;

	// The run executes a pinned version; fetch it when it is not the live one.
	const liveVersionId = workflow?.liveGraph?.id;
	const needsPinnedVersion =
		!!run && !!liveVersionId && run.versionId !== liveVersionId;
	const pinnedVersionQuery = cloudTrpc.workflow.getVersion.useQuery(
		{ workflowId, versionId: run?.versionId ?? "" },
		{ enabled: needsPinnedVersion, staleTime: Number.POSITIVE_INFINITY },
	);

	const [nodes, setNodes] = useState<CanvasNode[]>([]);
	const [edges, setEdges] = useState<CanvasEdge[]>([]);
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
	const selectNode = useCallback((nodeId: string | null) => {
		setSelectedNodeId(nodeId);
		if (nodeId) setPanelTab("config");
	}, []);
	const [dirty, setDirty] = useState(false);
	const [generateOpen, setGenerateOpen] = useState(false);
	// Remounting the canvas fits the view to a newly generated graph.
	const [canvasKey, setCanvasKey] = useState(0);
	const takePendingDraft = usePendingWorkflowDraftStore((s) => s.takeDraft);
	const [conflictOpen, setConflictOpen] = useState(false);
	// The version the loaded graph was built on; saves race against it.
	const expectedVersionRef = useRef(0);
	const loadedWorkflowRef = useRef<string | null>(null);

	useEffect(() => {
		if (!workflow) return;
		// Only seed once per workflow; later refetches must not clobber edits.
		if (loadedWorkflowRef.current === workflow.id) return;
		loadedWorkflowRef.current = workflow.id;
		const pendingDraft = takePendingDraft(workflow.id);
		const graph = pendingDraft ?? workflow.liveGraph?.graph ?? EMPTY_GRAPH;
		setNodes(toCanvasNodes(graph));
		setEdges(toCanvasEdges(graph));
		expectedVersionRef.current = workflow.headVersion;
		setDirty(pendingDraft !== null);
	}, [workflow, takePendingDraft]);

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
				? { x: last.position.x, y: last.position.y + LAYOUT_RANK_GAP }
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

	const applyGenerated = useCallback((generated: GeneratedWorkflow) => {
		setNodes(toCanvasNodes(generated.graph));
		setEdges(toCanvasEdges(generated.graph));
		setSelectedNodeId(null);
		setCanvasKey((key) => key + 1);
		setDirty(true);
		toast.success("Graph generated. Review it, then save.");
	}, []);

	const arrange = useCallback(() => {
		const graph = layoutWorkflowGraph(fromCanvas(nodes, edges));
		const byId = new Map(graph.nodes.map((node) => [node.id, node.position]));
		setNodes((current) =>
			current.map((node) => {
				const position = byId.get(node.id) ?? node.position;
				return {
					...node,
					position,
					data: { ...node.data, wf: { ...node.data.wf, position } },
				};
			}),
		);
		setCanvasKey((key) => key + 1);
		setDirty(true);
	}, [nodes, edges]);

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
			toast.success("Workflow saved");
		},
		onError: (error) => {
			if (error instanceof TRPCClientError && error.data?.code === "CONFLICT") {
				setConflictOpen(true);
				return;
			}
			toast.error(errorMessage(error, "Failed to save workflow"));
		},
	});

	const save = useCallback(() => {
		if (readOnly || saveMutation.isPending) return;
		const graph = fromCanvas(nodes, edges);
		const parsed = workflowGraphSchema.safeParse(graph);
		if (!parsed.success) {
			const issue = parsed.error.issues[0];
			toast.error(
				"Fix the graph before saving" +
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
	}, [nodes, edges, readOnly, saveMutation]);

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
			toast.error(errorMessage(error, "Failed to update workflow")),
	});

	const runNowMutation = useMutation({
		mutationFn: () => apiTrpcClient.workflow.runNow.mutate({ workflowId }),
		onSuccess: (started) => {
			toast.success("Running now");
			void utils.workflow.listRuns.invalidate({ workflowId });
			void navigate({ search: { runId: started.runId } });
		},
		onError: (error) => toast.error(errorMessage(error, "Failed to start run")),
	});

	const [cancelOpen, setCancelOpen] = useState(false);
	const cancelMutation = useMutation({
		mutationFn: (id: string) =>
			apiTrpcClient.workflow.cancelRun.mutate({ runId: id }),
		onSuccess: () => {
			void utils.workflow.getRun.invalidate({ runId: runId ?? "" });
			void utils.workflow.listRuns.invalidate({ workflowId });
		},
		onError: (error) =>
			toast.error(errorMessage(error, "Failed to cancel run")),
	});

	const exitRunView = useCallback(() => {
		setSelectedNodeId(null);
		void navigate({ search: {} });
	}, [navigate]);

	const selectRun = useCallback(
		(id: string) => {
			setSelectedNodeId(null);
			void navigate({ search: { runId: id } });
		},
		[navigate],
	);

	// Run view renders the pinned graph, decorated with step statuses, instead
	// of the editable canvas state.
	const runGraph = useMemo(() => {
		if (!run) return null;
		if (needsPinnedVersion) return pinnedVersionQuery.data?.graph ?? null;
		return workflow?.liveGraph?.graph ?? null;
	}, [run, needsPinnedVersion, pinnedVersionQuery.data, workflow]);

	const runCanvas = useMemo(() => {
		if (!run || !runGraph) return null;
		const decorated = applyRunSteps(
			toCanvasNodes(runGraph),
			toCanvasEdges(runGraph),
			run.steps,
		);
		return {
			nodes: decorated.nodes.map((node) => ({
				...node,
				selected: node.id === selectedNodeId,
			})),
			edges: decorated.edges,
		};
	}, [run, runGraph, selectedNodeId]);

	const selectedStep: RunStepRow | null = useMemo(() => {
		if (!run || !selectedNodeId) return null;
		return (
			(run.steps.find((step) => step.nodeId === selectedNodeId) as
				| RunStepRow
				| undefined) ?? null
		);
	}, [run, selectedNodeId]);

	if (!workflow) {
		if (workflowQuery.isPending) return null;
		return (
			<div className="flex h-full items-center justify-center text-sm text-muted-foreground">
				Workflow not found.
			</div>
		);
	}

	const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

	return (
		<div className="flex h-full w-full flex-col overflow-hidden">
			<div className="flex items-center gap-3 border-b px-4 py-2">
				<Button asChild variant="ghost" size="icon-sm">
					<Link to="/workflows" aria-label="Back to workflows">
						<LuChevronLeft className="size-4" />
					</Link>
				</Button>
				<div className="min-w-0 flex-1">
					<EditableTitle
						name={workflow.name}
						label="Workflow name"
						maxLength={200}
						onRename={(name) => renameMutation.mutate(name)}
					/>
				</div>
				<div className="flex items-center gap-2">
					{dirty && !run && (
						<span className="text-xs text-muted-foreground">
							Unsaved changes
						</span>
					)}
					{!readOnly && !run && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setGenerateOpen(true)}
						>
							<LuSparkles className="size-3.5" />
							Generate
						</Button>
					)}
					<Switch
						checked={workflow.enabled}
						onCheckedChange={(enabled) => setEnabledMutation.mutate(enabled)}
						disabled={readOnly || setEnabledMutation.isPending}
						aria-label="Enabled"
					/>
					<Button
						variant="outline"
						size="sm"
						onClick={() => runNowMutation.mutate()}
						disabled={runNowMutation.isPending || !workflow.liveVersionId}
					>
						<LuPlay className="size-3.5" />
						Run now
					</Button>
					<Button
						size="sm"
						onClick={save}
						disabled={readOnly || !dirty || saveMutation.isPending}
					>
						<LuSave className="size-3.5" />
						Save
					</Button>
					<Button
						variant={panelTab === "runs" ? "secondary" : "ghost"}
						size="sm"
						onClick={() =>
							setPanelTab((tab) => (tab === "runs" ? "config" : "runs"))
						}
						aria-label="Run history"
					>
						<LuHistory className="size-3.5" />
						Runs
					</Button>
				</div>
			</div>

			{run && (
				<div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-1.5 text-sm">
					<span
						className={cn(
							"size-2 rounded-full",
							RUN_STATUS_META[run.status].dot,
						)}
					/>
					<span className="font-medium">
						{RUN_STATUS_META[run.status].label}
					</span>
					<span className="text-xs text-muted-foreground">
						{formatCompactRelativeTime(
							new Date(run.startedAt ?? run.createdAt),
							now,
						)}
						{run.startedAt && run.finishedAt && (
							<>
								{" · "}
								{formatElapsed(
									new Date(run.startedAt),
									new Date(run.finishedAt),
								)}
							</>
						)}
					</span>
					{run.error && (
						<span className="min-w-0 truncate text-xs text-red-500">
							{run.error}
						</span>
					)}
					<div className="ml-auto flex items-center gap-2">
						{isActiveRunStatus(run.status) && (
							<Button
								variant="outline"
								size="sm"
								onClick={() => setCancelOpen(true)}
								disabled={cancelMutation.isPending}
							>
								<LuCircleStop className="size-3.5" />
								Cancel run
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={exitRunView}>
							<LuX className="size-3.5" />
							Back to editor
						</Button>
					</div>
				</div>
			)}

			<div className="flex min-h-0 flex-1">
				<div className="min-w-0 flex-1">
					{run && runCanvas ? (
						<WorkflowCanvas
							nodes={runCanvas.nodes}
							edges={runCanvas.edges}
							onNodesChange={() => {}}
							onEdgesChange={() => {}}
							onConnect={() => {}}
							onSelectNode={selectNode}
							onAddNode={() => {}}
							readOnly
						/>
					) : (
						<WorkflowCanvas
							key={canvasKey}
							nodes={nodes}
							edges={edges}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							onConnect={onConnect}
							onSelectNode={selectNode}
							onAddNode={onAddNode}
							onArrange={arrange}
							readOnly={readOnly}
						/>
					)}
				</div>
				<ResizablePanel
					width={sidePanelWidth}
					onWidthChange={setSidePanelWidth}
					minWidth={MIN_WORKFLOW_SIDE_PANEL_WIDTH}
					maxWidth={MAX_WORKFLOW_SIDE_PANEL_WIDTH}
					handleSide="left"
					commitOnRelease
					onDoubleClickHandle={() =>
						setSidePanelWidth(DEFAULT_WORKFLOW_SIDE_PANEL_WIDTH)
					}
				>
					{panelTab === "runs" ? (
						<RunsPanel
							workflowId={workflowId}
							selectedRunId={runId ?? null}
							onSelectRun={selectRun}
						/>
					) : run ? (
						<RunStepPanel step={selectedStep} />
					) : (
						<NodeConfigPanel
							workflowId={workflowId}
							node={selectedNode}
							nodes={nodes}
							edges={edges}
							onChangeNode={onChangeNode}
							onDeleteNode={onDeleteNode}
							readOnly={readOnly}
						/>
					)}
				</ResizablePanel>
			</div>

			<GenerateWorkflowDialog
				open={generateOpen}
				onOpenChange={setGenerateOpen}
				title="Generate with AI"
				description="Describe the workflow or the change you want. The result stays unsaved until you click Save."
				getCurrentGraph={() => fromCanvas(nodes, edges)}
				onGenerated={applyGenerated}
			/>

			<AlertDialog open={conflictOpen} onOpenChange={setConflictOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Workflow changed elsewhere</AlertDialogTitle>
						<AlertDialogDescription>
							Someone saved a newer version of this workflow. Reload to get
							their changes, or keep editing and save again to retry on top of
							your copy.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => void keepEditing()}>
							Keep editing
						</AlertDialogCancel>
						<AlertDialogAction onClick={reloadLatest}>
							Reload latest
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Cancel this run?</AlertDialogTitle>
						<AlertDialogDescription>
							Steps that are still running will be stopped. Finished steps keep
							their results.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep running</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								if (runId) cancelMutation.mutate(runId);
							}}
						>
							Cancel run
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

import {
	evaluateCondition,
	type RunContext,
	renderTemplate,
	subtreeBehindEdges,
	topologicalOrder,
	type WorkflowGraph,
	type WorkflowNode,
	outgoingEdges,
} from "@superset/shared/workflow-graph";
import {
	ActivityCancellationType,
	ActivityFailure,
	ApplicationFailure,
	CancellationScope,
	isCancellation,
	log,
	proxyActivities,
} from "@temporalio/workflow";
import type { WorkflowRunActivities } from "../../activities/workflowActivities";

const quick = proxyActivities<WorkflowRunActivities>({
	startToCloseTimeout: "30 seconds",
	retry: { maximumAttempts: 10 },
});

/** Dispatch starts a workspace and an agent; a retry would start a second one. */
const dispatch = proxyActivities<WorkflowRunActivities>({
	startToCloseTimeout: "3 minutes",
	retry: { maximumAttempts: 1 },
});

const capture = proxyActivities<WorkflowRunActivities>({
	startToCloseTimeout: "2 minutes",
	retry: { maximumAttempts: 5 },
});

const MINUTE_MS = 60_000;

/** Long polls: each attempt heartbeats; the node's own timeout bounds the total. */
function pollProxy(totalTimeoutMs: number) {
	return proxyActivities<WorkflowRunActivities>({
		scheduleToCloseTimeout: totalTimeoutMs,
		startToCloseTimeout: "15 minutes",
		heartbeatTimeout: "1 minute",
		cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
		retry: {
			initialInterval: "5 seconds",
			backoffCoefficient: 2,
			maximumInterval: "5 minutes",
		},
	});
}

function oneShotProxy(totalTimeoutMs: number, attempts: number) {
	return proxyActivities<WorkflowRunActivities>({
		scheduleToCloseTimeout: totalTimeoutMs,
		startToCloseTimeout: totalTimeoutMs,
		retry: { maximumAttempts: attempts },
	});
}

class NodeFailure extends Error {
	constructor(
		readonly nodeId: string,
		message: string,
		readonly timedOut: boolean,
	) {
		super(message);
		this.name = "NodeFailure";
	}
}

/**
 * One workflow run: walk the graph in topological waves, run each node's
 * activity with its own timeout, and record every state change through the
 * API. Statuses live in the database; this history holds only ids.
 */
export async function workflowRun(args: { runId: string }): Promise<void> {
	const { runId } = args;
	const loaded = await quick.loadWorkflowRun({ runId });
	const graph = loaded.graph;
	await quick.recordRunStatus({ runId, status: "running" });

	const context: RunContext = {
		runId,
		trigger: loaded.triggerContext,
		nodes: {},
	};
	const finished = new Set<string>();
	const droppedEdges = new Set<string>();
	const activeCliJobs = new Map<string, { hostId: string; jobId: string }>();
	const startedNodes = new Set<string>();

	const record = (
		node: WorkflowNode,
		status: "running" | "succeeded" | "failed" | "skipped" | "canceled",
		extra: { input?: unknown; output?: unknown; error?: string } = {},
	) =>
		quick.recordStep({
			runId,
			nodeId: node.id,
			nodeType: node.type,
			status,
			...extra,
		});

	const markSkipped = async (pending: Set<string>) => {
		const skipped = subtreeBehindEdges(graph, droppedEdges);
		for (const nodeId of skipped) {
			if (finished.has(nodeId)) continue;
			const node = graph.nodes.find((n) => n.id === nodeId);
			if (!node) continue;
			finished.add(nodeId);
			pending.delete(nodeId);
			await record(node, "skipped");
		}
	};

	const runNode = async (node: WorkflowNode): Promise<void> => {
		startedNodes.add(node.id);
		try {
			const output = await executeNode(node);
			context.nodes[node.id] = { output };
			await record(node, "succeeded", { output });
		} catch (error) {
			if (isCancellation(error)) throw error;
			const timedOut = hasTimeoutCause(error);
			const message = failureMessage(error);
			await record(node, "failed", { error: message });
			throw new NodeFailure(node.id, message, timedOut);
		} finally {
			activeCliJobs.delete(node.id);
		}
	};

	const executeNode = async (node: WorkflowNode): Promise<unknown> => {
		switch (node.type) {
			case "trigger": {
				await record(node, "running");
				return loaded.triggerContext ?? null;
			}
			case "agent": {
				const prompt = renderTemplate(context, node.config.prompt);
				await record(node, "running", {
					input: { agent: node.config.agent, prompt },
				});
				const target =
					node.config.target.hostId === "cloud"
						? { hostId: "cloud" }
						: {
								hostId: node.config.target.hostId,
								...(node.config.target.v2ProjectId
									? { v2ProjectId: node.config.target.v2ProjectId }
									: {}),
							};
				const handle = await dispatch.dispatchAgentNode({
					runId,
					nodeId: node.id,
					agent: node.config.agent,
					prompt,
					target,
				});
				const timeoutMs =
					Math.min(node.config.timeoutMinutes, 240) * MINUTE_MS;
				const { state } = await pollProxy(timeoutMs).awaitAgentNode({
					runId,
					handle,
				});
				const output = await capture.captureAgentOutput({ runId, handle });
				if (state === "blocked") {
					throw ApplicationFailure.nonRetryable(
						"Agent stopped waiting for input.",
						"AgentBlocked",
					);
				}
				return output;
			}
			case "cli": {
				const command = renderTemplate(context, node.config.command);
				await record(node, "running", { input: { command } });
				const workspaceId = node.config.target.v2WorkspaceId;
				if (!workspaceId) {
					// TODO(workflows): create a session workspace when none is pinned.
					throw ApplicationFailure.nonRetryable(
						"CLI nodes need a workspace (target.v2WorkspaceId).",
						"BadCliNode",
					);
				}
				const timeoutMs = Math.min(node.config.timeoutMinutes, 120) * MINUTE_MS;
				const { jobId } = await dispatch.execCliNode({
					runId,
					nodeId: node.id,
					attempt: 1,
					hostId: node.config.target.hostId,
					workspaceId,
					command,
					maxRuntimeMs: timeoutMs,
				});
				activeCliJobs.set(node.id, {
					hostId: node.config.target.hostId,
					jobId,
				});
				const result = await pollProxy(timeoutMs + MINUTE_MS).pollCliNode({
					runId,
					hostId: node.config.target.hostId,
					jobId,
				});
				if (result.status !== "done") {
					throw ApplicationFailure.nonRetryable(
						`Command ${result.status} (exit ${result.exitCode ?? "unknown"}): ${result.tail.slice(-500)}`,
						"CliNodeFailed",
					);
				}
				return { exitCode: result.exitCode, text: result.tail };
			}
			case "llm": {
				const prompt = renderTemplate(context, node.config.prompt);
				const system = node.config.system
					? renderTemplate(context, node.config.system)
					: undefined;
				await record(node, "running", { input: { prompt } });
				const timeoutMs = 5 * MINUTE_MS;
				return oneShotProxy(timeoutMs, 3).callLlmNode({
					runId,
					prompt,
					...(system ? { system } : {}),
					model: node.config.model,
					maxTokens: node.config.maxTokens,
					...(node.config.jsonSchema ? { jsonSchema: node.config.jsonSchema } : {}),
				});
			}
			case "http": {
				const url = renderTemplate(context, node.config.url);
				const headers = Object.fromEntries(
					Object.entries(node.config.headers).map(([name, value]) => [
						name,
						renderTemplate(context, value),
					]),
				);
				const body =
					node.config.body !== undefined
						? renderTemplate(context, node.config.body)
						: undefined;
				// Header values routinely carry tokens; the record keeps names only.
				await record(node, "running", {
					input: {
						method: node.config.method,
						url,
						headerNames: Object.keys(headers),
					},
				});
				const timeoutMs = Math.min(node.config.timeoutSeconds, 300) * 1000;
				return oneShotProxy(timeoutMs * 3 + MINUTE_MS, 3).callHttpNode({
					method: node.config.method,
					url,
					headers,
					...(body !== undefined ? { body } : {}),
					timeoutSeconds: Math.min(node.config.timeoutSeconds, 300),
				});
			}
			case "condition": {
				await record(node, "running");
				const result = evaluateCondition(context, node.config.expression);
				for (const edge of outgoingEdges(graph, node.id)) {
					if (edge.sourceHandle !== String(result)) droppedEdges.add(edge.id);
				}
				return { result };
			}
		}
	};

	try {
		const order = topologicalOrder(graph);
		if (!order) {
			throw ApplicationFailure.nonRetryable("Graph has a cycle.", "BadGraph");
		}
		const pending = new Set(order);
		while (pending.size > 0) {
			await markSkipped(pending);
			const ready = [...pending]
				.filter((nodeId) =>
					graph.edges
						.filter((edge) => edge.target === nodeId)
						.every((edge) => finished.has(edge.source)),
				)
				.sort();
			if (ready.length === 0) break;
			// allSettled, so one failed branch does not orphan its siblings
			// mid-activity; the first failure then fails the run.
			const results = await Promise.allSettled(
				ready.map((nodeId) => {
					pending.delete(nodeId);
					const node = graph.nodes.find((n) => n.id === nodeId);
					if (!node) return Promise.resolve();
					return runNode(node).then(() => {
						finished.add(nodeId);
					});
				}),
			);
			for (const result of results) {
				if (result.status === "rejected") throw result.reason;
			}
		}
		await markSkipped(pending);
		await quick.recordRunStatus({ runId, status: "succeeded" });
	} catch (error) {
		if (isCancellation(error)) {
			await CancellationScope.nonCancellable(async () => {
				for (const [nodeId, job] of activeCliJobs) {
					await quick
						.killCliNode({ runId, hostId: job.hostId, jobId: job.jobId })
						.catch((killError: unknown) =>
							log.error("Could not kill CLI job", {
								nodeId,
								error: failureMessage(killError),
							}),
						);
				}
				for (const nodeId of startedNodes) {
					if (finished.has(nodeId)) continue;
					const node = graph.nodes.find((n) => n.id === nodeId);
					if (node) await record(node, "canceled");
				}
				await quick.recordRunStatus({ runId, status: "canceled" });
			});
			throw error;
		}
		const timedOut = error instanceof NodeFailure && error.timedOut;
		await quick.recordRunStatus({
			runId,
			status: timedOut ? "timed_out" : "failed",
			error: failureMessage(error),
		});
		return;
	}
}

function failureMessage(error: unknown): string {
	if (error instanceof ActivityFailure && error.cause) {
		return error.cause.message;
	}
	return error instanceof Error ? error.message : String(error);
}

function hasTimeoutCause(error: unknown): boolean {
	let current: unknown = error;
	for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
		if (current.name === "TimeoutFailure") return true;
		current = current.cause;
	}
	return false;
}

import {
	evaluateCondition,
	outgoingEdges,
	type RunContext,
	renderTemplate,
	subtreeBehindEdges,
	topologicalOrder,
	type WorkflowNode,
} from "@superset/shared/workflow-graph";
import type { JobStatus } from "../../clients/workflowApi";
import type {
	ActivityInput,
	ActivityOutput,
	DurableContext,
} from "../durableContext";
import { NodeError } from "../nodeError";
import {
	CAPTURE,
	DISPATCH,
	HTTP_ATTEMPTS,
	LLM,
	MAX_AGENT_MINUTES,
	MAX_CLI_MINUTES,
	MAX_CLI_TAIL,
	MAX_HTTP_SECONDS,
	MINUTE_MS,
	POLL_ATTEMPTS,
	POLL_SLACK_MS,
	QUICK,
} from "./constants";
import { pollInChunks } from "./pollInChunks";

type AgentState = Extract<
	ActivityOutput<"awaitAgentNode">,
	{ settled: true }
>["state"];
type CliResult = { status: JobStatus; exitCode: number | null };
type StepStatus = ActivityInput<"recordStep">["status"];

/**
 * One workflow run: walk the graph in topological waves, run each node's
 * work through the engine's context, and record every state change through
 * the API. Cancellation is rethrown; the engine owns what happens next.
 */
export async function runGraph(args: {
	ctx: DurableContext;
	runId: string;
}): Promise<void> {
	const { ctx, runId } = args;
	const loaded = await ctx.call(
		"loadWorkflowRun",
		{ runId },
		{
			key: "run:load",
			...QUICK,
		},
	);
	const graph = loaded.graph;
	await ctx.call(
		"recordRunStatus",
		{ runId, status: "running" },
		{
			key: "run:record:running",
			...QUICK,
		},
	);

	const context: RunContext = {
		runId,
		trigger: loaded.triggerContext,
		nodes: {},
	};
	const finished = new Set<string>();
	const droppedEdges = new Set<string>();

	const record = (
		node: WorkflowNode,
		status: StepStatus,
		extra: { input?: unknown; output?: unknown; error?: string } = {},
	) =>
		ctx.call(
			"recordStep",
			{ runId, nodeId: node.id, nodeType: node.type, status, ...extra },
			{ key: `${node.id}:record:${status}`, ...QUICK },
		);

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
		try {
			const output = await executeNode(node);
			context.nodes[node.id] = { output };
			await record(node, "succeeded", { output });
		} catch (error) {
			if (ctx.isCancellation(error)) throw error;
			await record(node, "failed", { error: failureMessage(error) });
			throw error;
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
					input: {
						agent: node.config.agent,
						model: node.config.model,
						effort: node.config.effort,
						prompt,
					},
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
				const handle = await ctx.call(
					"dispatchAgentNode",
					{
						runId,
						nodeId: node.id,
						agent: node.config.agent,
						...(node.config.model ? { model: node.config.model } : {}),
						...(node.config.effort ? { effort: node.config.effort } : {}),
						prompt,
						target,
					},
					{ key: `${node.id}:dispatch`, ...DISPATCH },
				);
				const state = await pollInChunks<AgentState>({
					totalMs:
						Math.min(node.config.timeoutMinutes, MAX_AGENT_MINUTES) * MINUTE_MS,
					chunkMs: ctx.pollChunkMs,
					label: "Agent",
					poll: async ({ budgetMs, index }) => {
						const result = await ctx.call(
							"awaitAgentNode",
							{ runId, handle, budgetMs },
							{
								key: `${node.id}:await:${index}`,
								timeoutMs: budgetMs + POLL_SLACK_MS,
								attempts: POLL_ATTEMPTS,
							},
						);
						return result.settled
							? { done: true, value: result.state }
							: { done: false };
					},
				});
				const output = await ctx.call(
					"captureAgentOutput",
					{ runId, handle },
					{ key: `${node.id}:capture`, ...CAPTURE },
				);
				if (state === "blocked") {
					throw new NodeError({
						message: "Agent stopped waiting for input.",
						code: "AgentBlocked",
						retryable: false,
					});
				}
				return output;
			}
			case "cli": {
				const command = renderTemplate(context, node.config.command);
				await record(node, "running", { input: { command } });
				const workspaceId = node.config.target.v2WorkspaceId;
				if (!workspaceId) {
					throw new NodeError({
						message: "CLI nodes need a workspace (target.v2WorkspaceId).",
						code: "BadCliNode",
						retryable: false,
					});
				}
				const hostId = node.config.target.hostId;
				const timeoutMs =
					Math.min(node.config.timeoutMinutes, MAX_CLI_MINUTES) * MINUTE_MS;
				const { jobId } = await ctx.call(
					"execCliNode",
					{
						runId,
						nodeId: node.id,
						attempt: 1,
						hostId,
						workspaceId,
						command,
						maxRuntimeMs: timeoutMs,
					},
					{ key: `${node.id}:exec`, ...DISPATCH },
				);
				let offset = 0;
				let tail = "";
				const result = await pollInChunks<CliResult>({
					totalMs: timeoutMs + MINUTE_MS,
					chunkMs: ctx.pollChunkMs,
					label: "Command",
					poll: async ({ budgetMs, index }) => {
						const chunk = await ctx.call(
							"pollCliNode",
							{ runId, hostId, jobId, offset, budgetMs },
							{
								key: `${node.id}:poll:${index}`,
								timeoutMs: budgetMs + POLL_SLACK_MS,
								attempts: POLL_ATTEMPTS,
							},
						);
						offset = chunk.offset;
						tail = (tail + chunk.tail).slice(-MAX_CLI_TAIL);
						return chunk.status === "running"
							? { done: false }
							: {
									done: true,
									value: { status: chunk.status, exitCode: chunk.exitCode },
								};
					},
				});
				if (result.status !== "done") {
					throw new NodeError({
						message: `Command ${result.status} (exit ${result.exitCode ?? "unknown"}): ${tail.slice(-500)}`,
						code: "CliNodeFailed",
						retryable: false,
					});
				}
				return { exitCode: result.exitCode, text: tail };
			}
			case "llm": {
				const prompt = renderTemplate(context, node.config.prompt);
				const system = node.config.system
					? renderTemplate(context, node.config.system)
					: undefined;
				await record(node, "running", {
					input: {
						prompt,
						model: node.config.model,
						effort: node.config.effort,
					},
				});
				return ctx.call(
					"callLlmNode",
					{
						runId,
						prompt,
						...(system ? { system } : {}),
						model: node.config.model,
						...(node.config.effort ? { effort: node.config.effort } : {}),
						maxTokens: node.config.maxTokens,
						...(node.config.jsonSchema
							? { jsonSchema: node.config.jsonSchema }
							: {}),
					},
					{ key: `${node.id}:llm`, ...LLM },
				);
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
				const timeoutSeconds = Math.min(
					node.config.timeoutSeconds,
					MAX_HTTP_SECONDS,
				);
				return ctx.call(
					"callHttpNode",
					{
						method: node.config.method,
						url,
						headers,
						...(body !== undefined ? { body } : {}),
						timeoutSeconds,
					},
					{
						key: `${node.id}:http`,
						timeoutMs: timeoutSeconds * 1000 + MINUTE_MS,
						attempts: HTTP_ATTEMPTS,
					},
				);
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
			throw new NodeError({
				message: "Graph has a cycle.",
				code: "BadGraph",
				retryable: false,
			});
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
			// mid-call; the first failure then fails the run.
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
		await ctx.call(
			"recordRunStatus",
			{ runId, status: "succeeded" },
			{
				key: "run:record:succeeded",
				...QUICK,
			},
		);
	} catch (error) {
		if (ctx.isCancellation(error)) throw error;
		const timedOut = error instanceof NodeError && error.timedOut;
		const status = timedOut ? "timed_out" : "failed";
		await ctx.call(
			"recordRunStatus",
			{ runId, status, error: failureMessage(error) },
			{ key: `run:record:${status}`, ...QUICK },
		);
	}
}

function failureMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

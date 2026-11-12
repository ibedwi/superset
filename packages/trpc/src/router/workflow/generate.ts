import Anthropic from "@anthropic-ai/sdk";
import {
	type DraftWorkflowGraph,
	type DraftWorkflowNode,
	draftWorkflowGraphSchema,
	getWorkflowLlmEfforts,
	layoutWorkflowGraph,
	MAX_NODES,
	referencedNodeIds,
	validateGraph,
	WORKFLOW_LLM_MODELS,
	type WorkflowCondition,
	type WorkflowGraph,
	workflowLlmEffortConfig,
} from "@superset/shared/workflow-graph";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { z } from "zod";
import { env } from "../../env";
import { personProcedure } from "../../trpc";
import { requireActiveOrgMembership } from "../utils/active-org";

export const GENERATE_GRAPH_MODEL = "claude-sonnet-5-5";
const DEFAULT_LLM_NODE_MODEL = "claude-sonnet-5-5";
const MAX_ATTEMPTS = 3;
const MAX_NAME_LENGTH = 120;

export type GraphModelMessage = { role: "user" | "assistant"; content: string };
export type AskGraphModel = (messages: GraphModelMessage[]) => Promise<string>;

export type GeneratedGraph = { graph: DraftWorkflowGraph; name: string | null };

type CheckResult =
	| { ok: true; value: GeneratedGraph }
	| { ok: false; problems: string[] };

const SYSTEM_PROMPT = `You design workflow automations as JSON graphs for a canvas editor.

Reply with ONE JSON object and nothing else:
{"name": string, "nodes": Node[], "edges": Edge[]}

"name" is a short title for the workflow (max ${MAX_NAME_LENGTH} characters).

Node: {"id": string, "type": NodeType, "name": string, "config": object}
- "id": lowercase slug, /^[a-z0-9][a-z0-9_-]{0,63}$/, unique, readable (for example "fetch_prs").
- "name": short label shown on the canvas.
- Do not add "position"; the editor lays out the graph.

Node types and their config:
- "trigger": config {}. Exactly one, with id "trigger". It starts every run. Its schedule, webhook, or event is set in the editor, not in the graph, so describe the timing only in the trigger "name" (for example "Every weekday at 9:00").
- "llm": {"prompt": string, "model": string, "system"?: string, "maxTokens"?: number, "jsonSchema"?: object}. One model call. Output: {"text": string, "json"?: any}; "json" is set only when "jsonSchema" is given. Models: ${WORKFLOW_LLM_MODELS.map((model) => model.id).join(", ")}. Use "${DEFAULT_LLM_NODE_MODEL}" unless the user asks for another.
- "http": {"method": "GET"|"POST"|"PUT"|"PATCH"|"DELETE"|"HEAD", "url": string, "headers"?: {string: string}, "body"?: string}. Output: {"status": number, "body": string, "json"?: any}. Use real public API URLs when you know them (for example https://api.github.com/...). Use "" for a URL the user must supply, such as their own webhook.
- "agent": {"agent": "claude", "prompt": string}. A coding agent that works in a repository on the user's machine. Output: {"text": string, "json"?: any}. Use it only for work that needs a codebase or many tool calls.
- "cli": {"command": string}. A shell command on the user's machine. Output: {"exitCode": number, "text": string}.
- "condition": {"expression": Condition}. Branches the run. Its outgoing edges must set "sourceHandle" to "true" or "false".
  Condition: {"left": Operand, "op": Op, "right"?: Operand} | {"all": Condition[]} | {"any": Condition[]}
  Operand: {"ref": "nodes.<id>.output.<path>"} | {"value": string | number | boolean | null}
  Op: eq, neq, contains, gt, gte, lt, lte, exists, truthy ("exists" and "truthy" take no "right").

Edge: {"id": string, "source": string, "target": string, "sourceHandle"?: "true"|"false"}
- Edges go from the trigger forward. No cycles, no edges into the trigger, every node reachable from the trigger.

Strings in prompts, URLs, headers, bodies, and commands can use templates:
- {{nodes.<id>.output.<path>}}: output of an upstream node, for example {{nodes.summarize.output.text}}.
- {{trigger.<path>}}: the event that started the run.
- {{run.id}}: the run id.
A node can only reference nodes that run before it on a path from the trigger.

Never put secrets or tokens in the graph; leave a header value as "" when the user must fill it in.
Keep graphs small: at most ${MAX_NODES} nodes, usually fewer than 8.`;

function userPrompt(description: string, current?: DraftWorkflowGraph) {
	if (!current) return `Build a workflow for this request:\n\n${description}`;
	const stripped = {
		nodes: current.nodes.map(({ position: _position, ...node }) => node),
		edges: current.edges,
	};
	return [
		"This is the current workflow:",
		JSON.stringify(stripped),
		"Change it for this request and return the complete updated graph. Keep the ids, configs, and targets of nodes you do not need to change.",
		description,
	].join("\n\n");
}

function extractJson(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const body = (fenced?.[1] ?? text).trim();
	const start = body.indexOf("{");
	const end = body.lastIndexOf("}");
	if (start === -1 || end <= start) return undefined;
	try {
		return JSON.parse(body.slice(start, end + 1)) as unknown;
	} catch {
		return undefined;
	}
}

function templatesOf(node: DraftWorkflowNode): string[] {
	switch (node.type) {
		case "trigger":
			return [];
		case "agent":
			return [node.config.prompt];
		case "llm":
			return [node.config.prompt, node.config.system ?? ""];
		case "http":
			return [
				node.config.url,
				node.config.body ?? "",
				...Object.values(node.config.headers),
			];
		case "cli":
			return [node.config.command];
		case "condition":
			return node.config.expression
				? conditionRefs(node.config.expression).map((ref) => `{{${ref}}}`)
				: [];
	}
}

function conditionRefs(condition: WorkflowCondition): string[] {
	if ("all" in condition) return condition.all.flatMap(conditionRefs);
	if ("any" in condition) return condition.any.flatMap(conditionRefs);
	return [condition.left, condition.right].flatMap((operand) =>
		operand && "ref" in operand ? [operand.ref] : [],
	);
}

function ancestorsOf(nodeId: string, graph: DraftWorkflowGraph): Set<string> {
	const seen = new Set<string>();
	const stack = [nodeId];
	for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
		for (const edge of graph.edges) {
			if (edge.target === id && !seen.has(edge.source)) {
				seen.add(edge.source);
				stack.push(edge.source);
			}
		}
	}
	return seen;
}

/** Fixes what the model cannot know: valid model ids and the user's hosts. */
function normalizeNode(
	node: DraftWorkflowNode,
	knownHostIds: Set<string>,
): DraftWorkflowNode {
	if (node.type === "llm") {
		const model = WORKFLOW_LLM_MODELS.some((m) => m.id === node.config.model)
			? node.config.model
			: DEFAULT_LLM_NODE_MODEL;
		const { effort, ...config } = node.config;
		const keepEffort = effort && getWorkflowLlmEfforts(model).includes(effort);
		return {
			...node,
			config: { ...config, model, ...(keepEffort ? { effort } : {}) },
		};
	}
	if (node.type === "agent" || node.type === "cli") {
		const { target, ...config } = node.config;
		if (target && knownHostIds.has(target.hostId)) return node;
		return { ...node, config } as DraftWorkflowNode;
	}
	return node;
}

export function checkGeneratedGraph(
	output: unknown,
	current?: DraftWorkflowGraph,
): CheckResult {
	if (!output || typeof output !== "object" || Array.isArray(output)) {
		return { ok: false, problems: ["The reply was not a JSON object."] };
	}
	const raw = output as { name?: unknown; nodes?: unknown; edges?: unknown };
	const nodes = Array.isArray(raw.nodes)
		? raw.nodes.map((node: unknown) =>
				node && typeof node === "object"
					? { position: { x: 0, y: 0 }, ...node }
					: node,
			)
		: raw.nodes;
	const parsed = draftWorkflowGraphSchema.safeParse({
		nodes,
		edges: raw.edges,
	});
	if (!parsed.success) {
		return {
			ok: false,
			problems: parsed.error.issues
				.slice(0, 20)
				.map((issue) => `${issue.path.join(".") || "graph"}: ${issue.message}`),
		};
	}

	const graph = parsed.data;
	// validateGraph reads only ids, types, and edges, which drafts share.
	const problems: string[] = validateGraph(graph as WorkflowGraph).map(
		(problem) => JSON.stringify(problem),
	);
	const ids = new Set(graph.nodes.map((node) => node.id));
	for (const node of graph.nodes) {
		const upstream = ancestorsOf(node.id, graph);
		for (const template of templatesOf(node)) {
			for (const ref of referencedNodeIds(template)) {
				if (!ids.has(ref))
					problems.push(`Node "${node.id}" references missing node "${ref}".`);
				else if (!upstream.has(ref))
					problems.push(
						`Node "${node.id}" references "${ref}", which does not run before it.`,
					);
			}
		}
	}
	if (problems.length > 0) return { ok: false, problems };

	const knownHostIds = new Set(
		(current?.nodes ?? []).flatMap((node) =>
			(node.type === "agent" || node.type === "cli") && node.config.target
				? [node.config.target.hostId]
				: [],
		),
	);
	const name =
		typeof raw.name === "string" && raw.name.trim()
			? raw.name.trim().slice(0, MAX_NAME_LENGTH)
			: null;
	return {
		ok: true,
		value: {
			name,
			graph: layoutWorkflowGraph({
				nodes: graph.nodes.map((node) => normalizeNode(node, knownHostIds)),
				edges: graph.edges,
			}),
		},
	};
}

/** Asks the model, then feeds validation problems back until the graph passes. */
export async function generateWorkflowGraph(params: {
	description: string;
	current?: DraftWorkflowGraph;
	ask: AskGraphModel;
	maxAttempts?: number;
}): Promise<GeneratedGraph> {
	const messages: GraphModelMessage[] = [
		{ role: "user", content: userPrompt(params.description, params.current) },
	];
	let problems: string[] = [];
	for (
		let attempt = 1;
		attempt <= (params.maxAttempts ?? MAX_ATTEMPTS);
		attempt++
	) {
		const reply = await params.ask(messages);
		const result = checkGeneratedGraph(extractJson(reply), params.current);
		if (result.ok) return result.value;
		problems = result.problems;
		messages.push(
			{ role: "assistant", content: reply },
			{
				role: "user",
				content: `That graph is not valid:\n- ${problems.join("\n- ")}\n\nReturn the complete corrected JSON object only.`,
			},
		);
	}
	throw new TRPCError({
		code: "UNPROCESSABLE_CONTENT",
		message: `Could not build a valid workflow from that description. Try to describe the steps more clearly. (${problems.slice(0, 3).join("; ")})`,
	});
}

function anthropicAsk(): AskGraphModel {
	const anthropic = new Anthropic({ apiKey: env.SERVER_ANTHROPIC_API_KEY });
	return async (messages) => {
		const response = await anthropic.messages
			.create({
				model: GENERATE_GRAPH_MODEL,
				max_tokens: 16_000,
				...workflowLlmEffortConfig(GENERATE_GRAPH_MODEL, "medium"),
				system: SYSTEM_PROMPT,
				messages,
			})
			.catch((error: unknown) => {
				console.error("[workflow/generateGraph] model call failed", error);
				throw new TRPCError({
					code: "BAD_GATEWAY",
					message: "The AI service did not respond. Try again.",
				});
			});
		return response.content
			.filter((block): block is Anthropic.TextBlock => block.type === "text")
			.map((block) => block.text)
			.join("");
	};
}

const generateRateLimit =
	env.KV_REST_API_URL && env.KV_REST_API_TOKEN
		? new Ratelimit({
				redis: new Redis({
					url: env.KV_REST_API_URL,
					token: env.KV_REST_API_TOKEN,
				}),
				limiter: Ratelimit.slidingWindow(30, "1 h"),
				prefix: "ratelimit:workflow:generate",
			})
		: null;

async function assertGenerateRateLimit(userId: string) {
	if (!generateRateLimit) return;
	const success = await generateRateLimit.limit(userId).then(
		(result) => result.success,
		(error: unknown) => {
			console.error("[workflow/generateGraph] rate limit check failed", error);
			return true;
		},
	);
	if (!success) {
		throw new TRPCError({
			code: "TOO_MANY_REQUESTS",
			message: "Too many workflow generations. Try again later.",
		});
	}
}

export const workflowGenerateProcedures = {
	/** Returns an unsaved draft graph; the editor shows it for review before Save. */
	generateGraph: personProcedure
		.input(
			z.object({
				description: z.string().trim().min(1).max(4000),
				graph: z.unknown().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			await requireActiveOrgMembership(ctx);
			let current: DraftWorkflowGraph | undefined;
			if (input.graph !== undefined) {
				const parsed = draftWorkflowGraphSchema.safeParse(input.graph);
				if (!parsed.success) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "The current graph is not valid.",
						cause: parsed.error.issues,
					});
				}
				current = parsed.data;
			}
			await assertGenerateRateLimit(ctx.session.user.id);
			return generateWorkflowGraph({
				description: input.description,
				current,
				ask: anthropicAsk(),
			});
		}),
} satisfies TRPCRouterRecord;

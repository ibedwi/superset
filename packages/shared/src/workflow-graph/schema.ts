import { z } from "zod";

/**
 * The workflow canvas document, shared by the editor and the API so the form
 * blocks Save on exactly what the server would reject.
 *
 * Two levels, mirroring automation-triggers:
 *
 * - `draftWorkflowGraphSchema` accepts half-configured nodes. The editor has
 *   to hold a freshly dropped Agent node with an empty prompt.
 * - `workflowGraphSchema` is what may be saved and executed.
 *
 * The graph is stored in jsonb and replayed through Temporal history, so every
 * string is bounded and the node/edge counts are capped.
 */

export const MAX_NODES = 50;
export const MAX_EDGES = 200;

/**
 * Node ids are user-visible slugs: downstream nodes reference outputs as
 * `{{nodes.<id>.output.<path>}}`, so they must be readable and stable, not
 * uuids.
 */
export const nodeIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

const positionSchema = z.object({ x: z.number(), y: z.number() });

const boundedText = (max: number) => z.string().max(max);

export const workflowConditionLeafOps = [
	"eq",
	"neq",
	"contains",
	"gt",
	"gte",
	"lt",
	"lte",
	"exists",
	"truthy",
] as const;
export type WorkflowConditionOp = (typeof workflowConditionLeafOps)[number];

const operandSchema = z.union([
	// A reference into the run context, e.g. "nodes.review.output.json.approved".
	z.object({ ref: boundedText(500) }),
	z.object({
		value: z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
	}),
]);
export type WorkflowConditionOperand = z.infer<typeof operandSchema>;

/**
 * Structured conditions only — no expression strings, no eval, and `contains`
 * is substring-only for the same ReDoS reason textFilterSchema pins
 * `isRegex: false`: the evaluation runs inside a deterministic Temporal
 * workflow where a backtracking blowup stalls the whole run.
 */
const leafConditionSchema = z.object({
	left: operandSchema,
	op: z.enum(workflowConditionLeafOps),
	right: operandSchema.optional(),
});
export type WorkflowLeafCondition = z.infer<typeof leafConditionSchema>;

export type WorkflowCondition =
	| WorkflowLeafCondition
	| { all: WorkflowCondition[] }
	| { any: WorkflowCondition[] };

export const workflowConditionSchema: z.ZodType<WorkflowCondition> = z.lazy(
	() =>
		z.union([
			leafConditionSchema,
			z.object({ all: z.array(workflowConditionSchema).min(1).max(20) }),
			z.object({ any: z.array(workflowConditionSchema).min(1).max(20) }),
		]),
);

const agentTargetSchema = z.object({
	hostId: z.union([z.string().min(1).max(128), z.literal("cloud")]),
	v2ProjectId: z.string().max(128).optional(),
	environmentId: z.string().max(128).optional(),
	machineSize: z.string().max(64).optional(),
});
export type WorkflowAgentTarget = z.infer<typeof agentTargetSchema>;

const cliTargetSchema = z.object({
	hostId: z.string().min(1).max(128),
	v2WorkspaceId: z.string().max(128).optional(),
	v2ProjectId: z.string().max(128).optional(),
});

const triggerConfigNode = z.object({});

const agentConfigDraft = z.object({
	agent: boundedText(64).default(""),
	prompt: boundedText(20_000).default(""),
	target: agentTargetSchema.optional(),
	timeoutMinutes: z.number().int().min(1).max(240).default(120),
});
const agentConfig = agentConfigDraft.extend({
	agent: z.string().min(1).max(64),
	prompt: z.string().min(1).max(20_000),
	target: agentTargetSchema,
});

const llmConfigDraft = z.object({
	prompt: boundedText(20_000).default(""),
	system: boundedText(10_000).optional(),
	model: boundedText(128).default(""),
	// JSON Schema the model's reply must validate against; absent means free text.
	jsonSchema: z.record(z.string(), z.unknown()).optional(),
	maxTokens: z.number().int().min(1).max(64_000).default(4096),
});
const llmConfig = llmConfigDraft.extend({
	prompt: z.string().min(1).max(20_000),
	model: z.string().min(1).max(128),
});

const httpConfigDraft = z.object({
	method: z
		.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
		.default("GET"),
	url: boundedText(2000).default(""),
	headers: z.record(z.string().max(128), z.string().max(2000)).default({}),
	body: boundedText(50_000).optional(),
	timeoutSeconds: z.number().int().min(1).max(300).default(30),
});
const httpConfig = httpConfigDraft.extend({
	url: z.string().min(1).max(2000).url(),
});

const conditionConfigDraft = z.object({
	expression: workflowConditionSchema.optional(),
});
const conditionConfig = z.object({
	expression: workflowConditionSchema,
});

const cliConfigDraft = z.object({
	command: boundedText(10_000).default(""),
	target: cliTargetSchema.optional(),
	timeoutMinutes: z.number().int().min(1).max(120).default(30),
});
const cliConfig = cliConfigDraft.extend({
	command: z.string().min(1).max(10_000),
	target: cliTargetSchema,
});

function nodeSchema<T extends string, C extends z.ZodType>(type: T, config: C) {
	return z.object({
		id: nodeIdSchema,
		type: z.literal(type),
		name: z.string().max(120).optional(),
		position: positionSchema,
		config,
	});
}

const strictNodeSchema = z.discriminatedUnion("type", [
	nodeSchema("trigger", triggerConfigNode),
	nodeSchema("agent", agentConfig),
	nodeSchema("llm", llmConfig),
	nodeSchema("http", httpConfig),
	nodeSchema("condition", conditionConfig),
	nodeSchema("cli", cliConfig),
]);
export type WorkflowNode = z.infer<typeof strictNodeSchema>;
export type WorkflowNodeType = WorkflowNode["type"];

const draftNodeSchema = z.discriminatedUnion("type", [
	nodeSchema("trigger", triggerConfigNode),
	nodeSchema("agent", agentConfigDraft),
	nodeSchema("llm", llmConfigDraft),
	nodeSchema("http", httpConfigDraft),
	nodeSchema("condition", conditionConfigDraft),
	nodeSchema("cli", cliConfigDraft),
]);
export type DraftWorkflowNode = z.infer<typeof draftNodeSchema>;

export const workflowEdgeSchema = z.object({
	id: z.string().min(1).max(160),
	source: nodeIdSchema,
	target: nodeIdSchema,
	// Only condition nodes have handles; "true"/"false" name the branch taken.
	sourceHandle: z.enum(["true", "false"]).optional(),
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

const viewportSchema = z.object({
	x: z.number(),
	y: z.number(),
	zoom: z.number().min(0.05).max(4),
});

function graphSchema<N extends z.ZodType>(node: N) {
	return z.object({
		nodes: z.array(node).max(MAX_NODES),
		edges: z.array(workflowEdgeSchema).max(MAX_EDGES),
		viewport: viewportSchema.optional(),
	});
}

export const workflowGraphSchema = graphSchema(strictNodeSchema);
export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;

export const draftWorkflowGraphSchema = graphSchema(draftNodeSchema);
export type DraftWorkflowGraph = z.infer<typeof draftWorkflowGraphSchema>;

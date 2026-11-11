import Anthropic from "@anthropic-ai/sdk";
import { mintUserJwt } from "@superset/auth/server";
import { db } from "@superset/db/client";
import {
	workflowRunStatusValues,
	workflowStepStatusValues,
} from "@superset/db/enums";
import {
	workflowRunSteps,
	workflowRuns,
	workflows,
	workflowVersions,
} from "@superset/db/schema";
import { agentRunState } from "@superset/shared/agent-status";
import {
	buildHostRoutingKey,
	CLOUD_HOST_ID,
} from "@superset/shared/host-routing";
import {
	workflowLlmEffortConfig,
	workflowLlmEffortValues,
} from "@superset/shared/workflow-graph";
import {
	sanitizeBranchNameWithMaxLength,
	slugifyForBranch,
} from "@superset/shared/workspace-launch";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../env";
import { nudge } from "../../lib/realtime";
import { workerProcedure } from "../../trpc";
import {
	type RelayClientOptions,
	RelayDispatchError,
	relayMutation,
	relayQuery,
} from "../automation/relay-client";

const runIdSchema = z.object({ runId: z.string().uuid() });

const runNotFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "Workflow run not found." });

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_RESULT_FILE_BYTES = 256 * 1024;

async function runScope(runId: string) {
	const [row] = await db
		.select({
			runId: workflowRuns.id,
			workflowId: workflowRuns.workflowId,
			organizationId: workflowRuns.organizationId,
			ownerUserId: workflows.ownerUserId,
		})
		.from(workflowRuns)
		.innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
		.where(eq(workflowRuns.id, runId))
		.limit(1);
	if (!row) throw runNotFound();
	return row;
}

async function hostRelay(
	scope: { runId: string; organizationId: string; ownerUserId: string },
	hostId: string,
	timeoutMs?: number,
): Promise<RelayClientOptions> {
	const jwt = await mintUserJwt({
		userId: scope.ownerUserId,
		organizationIds: [scope.organizationId],
		scope: "workflow-run",
		runId: scope.runId,
		ttlSeconds: 300,
	});
	return {
		relayUrl: env.RELAY_URL,
		hostId: buildHostRoutingKey(scope.organizationId, hostId),
		jwt,
		...(timeoutMs ? { timeoutMs } : {}),
	};
}

function hostCaller(options: RelayClientOptions) {
	return {
		mutation: <TOutput>(procedure: string, input: object) =>
			relayMutation<object, TOutput>(options, procedure, input),
		query: <TOutput>(procedure: string, input: object) =>
			relayQuery<object, TOutput>(options, procedure, input),
	};
}

const jobSessionId = (runId: string) => `workflow-${runId}`;

/** Serialized output must fit the step row; truncation is visible to readers. */
function capJson(value: unknown): unknown {
	const text = JSON.stringify(value) ?? "null";
	if (text.length <= MAX_OUTPUT_BYTES) return value;
	return { truncated: true, text: text.slice(0, MAX_OUTPUT_BYTES) };
}

/** Our Temporal worker running workflow graphs; secret-gated like agentWorker. */
export const workflowWorkerRouter = {
	loadRun: workerProcedure.input(runIdSchema).mutation(async ({ input }) => {
		const [row] = await db
			.select({
				id: workflowRuns.id,
				workflowId: workflowRuns.workflowId,
				organizationId: workflowRuns.organizationId,
				title: workflowRuns.title,
				status: workflowRuns.status,
				triggerContext: workflowRuns.triggerContext,
				graph: workflowVersions.graph,
			})
			.from(workflowRuns)
			.innerJoin(
				workflowVersions,
				eq(workflowVersions.id, workflowRuns.versionId),
			)
			.where(eq(workflowRuns.id, input.runId))
			.limit(1);
		if (!row) throw runNotFound();
		return row;
	}),

	recordRunStatus: workerProcedure
		.input(
			runIdSchema.extend({
				status: z.enum(workflowRunStatusValues),
				error: z.string().max(4000).nullish(),
			}),
		)
		.mutation(async ({ input }) => {
			const terminal = input.status !== "pending" && input.status !== "running";
			const [row] = await db
				.update(workflowRuns)
				.set({
					status: input.status,
					error: input.error ?? null,
					...(input.status === "running"
						? { startedAt: sql`COALESCE(${workflowRuns.startedAt}, now())` }
						: {}),
					...(terminal ? { finishedAt: new Date() } : {}),
				})
				.where(eq(workflowRuns.id, input.runId))
				.returning({ organizationId: workflowRuns.organizationId });
			if (!row) throw runNotFound();
			nudge(row.organizationId, "workflow_runs");
			return { recorded: true };
		}),

	recordStep: workerProcedure
		.input(
			runIdSchema.extend({
				nodeId: z.string().min(1).max(64),
				nodeType: z.string().min(1).max(32),
				status: z.enum(workflowStepStatusValues),
				input: z.unknown().nullish(),
				output: z.unknown().nullish(),
				error: z.string().max(4000).nullish(),
				attempt: z.number().int().positive().default(1),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const terminal = input.status !== "pending" && input.status !== "running";
			const now = new Date();
			await db
				.insert(workflowRunSteps)
				.values({
					runId: input.runId,
					nodeId: input.nodeId,
					nodeType: input.nodeType,
					status: input.status,
					input: input.input ?? null,
					output: input.output === undefined ? null : capJson(input.output),
					error: input.error ?? null,
					attempt: input.attempt,
					...(input.status === "running" ? { startedAt: now } : {}),
					...(terminal ? { finishedAt: now } : {}),
				})
				.onConflictDoUpdate({
					target: [workflowRunSteps.runId, workflowRunSteps.nodeId],
					set: {
						status: input.status,
						...(input.input !== undefined ? { input: input.input } : {}),
						...(input.output !== undefined
							? { output: capJson(input.output) }
							: {}),
						error: input.error ?? null,
						attempt: input.attempt,
						...(input.status === "running"
							? { startedAt: now, finishedAt: null }
							: {}),
						...(terminal ? { finishedAt: now } : {}),
					},
				});
			nudge(scope.organizationId, "workflow_runs");
			return { recorded: true };
		}),

	/**
	 * Starts the agent for an agent node on a host workspace and returns a
	 * handle the worker polls with `observeAgent`. Cloud targets are not wired
	 * yet (runInCloud is coupled to automation rows); the node fails with a
	 * clear message instead of half-running.
	 */
	dispatchAgent: workerProcedure
		.input(
			runIdSchema.extend({
				nodeId: z.string().min(1).max(64),
				agent: z.string().min(1).max(64),
				model: z.string().max(128).optional(),
				effort: z.string().max(64).optional(),
				prompt: z.string().min(1).max(100_000),
				target: z.object({
					hostId: z.string().min(1).max(128),
					v2ProjectId: z.string().uuid().optional(),
				}),
			}),
		)
		.mutation(async ({ input }) => {
			if (input.target.hostId === CLOUD_HOST_ID) {
				// TODO(workflows): cloud agent nodes need a workflow-shaped runInCloud.
				throw new TRPCError({
					code: "PRECONDITION_FAILED",
					message: "Cloud agent nodes are not supported yet; pick a host.",
				});
			}
			const scope = await runScope(input.runId);
			const relay = await hostRelay(scope, input.target.hostId, 90_000);
			const host = hostCaller(relay);

			const workspaceId = await createNodeWorkspace(
				host,
				input.runId,
				input.nodeId,
				input.target.v2ProjectId ?? null,
			);
			const session = await host.mutation<{ sessionId: string }>("agents.run", {
				workspaceId,
				agent: input.agent,
				...(input.model ? { model: input.model } : {}),
				...(input.effort ? { effort: input.effort } : {}),
				prompt: input.prompt,
			});
			return {
				hostId: input.target.hostId,
				workspaceId,
				terminalId: session.sessionId,
			};
		}),

	/** One observation of a host agent, mirroring the CLI's `waitForAgent` reads. */
	observeAgent: workerProcedure
		.input(
			runIdSchema.extend({
				hostId: z.string().min(1),
				workspaceId: z.string().min(1),
				terminalId: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const host = hostCaller(await hostRelay(scope, input.hostId));
			const bindings = await host.query<
				Array<{ terminalId: string; lastEventType: string }>
			>("terminalAgents.listByWorkspace", { workspaceId: input.workspaceId });
			const binding = bindings.find(
				(row) => row.terminalId === input.terminalId,
			);
			if (binding) return { state: agentRunState(binding.lastEventType) };
			const ended = await host
				.query<{ endedAt: unknown } | null>("terminalAgents.get", {
					workspaceId: input.workspaceId,
					terminalId: input.terminalId,
				})
				.then((row) => row?.endedAt != null)
				.catch(() => false);
			const running = await host
				.query<{ running: boolean }>("terminal.hasRunningProcess", {
					workspaceId: input.workspaceId,
					terminalId: input.terminalId,
				})
				.then((result) => result.running)
				.catch(() => false);
			if (ended && !running) return { state: "exited" as const };
			return { state: "starting" as const };
		}),

	/** The node's result file, relative to the workspace root. Null when absent. */
	readHostFile: workerProcedure
		.input(
			runIdSchema.extend({
				hostId: z.string().min(1),
				workspaceId: z.string().min(1),
				path: z.string().min(1).max(500),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const host = hostCaller(await hostRelay(scope, input.hostId));
			const context = await host.mutation<{ cwd: string }>(
				"agentJobs.context",
				{ workspaceId: input.workspaceId },
			);
			try {
				const file = await host.mutation<{ base64: string; size: number }>(
					"agentJobs.readFile",
					{
						path: `${context.cwd}/${input.path}`,
						maxBytes: MAX_RESULT_FILE_BYTES,
					},
				);
				return { found: true as const, base64: file.base64 };
			} catch (error) {
				if (error instanceof RelayDispatchError)
					return { found: false as const };
				throw error;
			}
		}),

	/** The agent's transcript tail, for output capture when no result file exists. */
	agentTranscript: workerProcedure
		.input(
			runIdSchema.extend({
				hostId: z.string().min(1),
				workspaceId: z.string().min(1),
				terminalId: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const host = hostCaller(await hostRelay(scope, input.hostId));
			const transcript = await host
				.query<{ text: string } | null>("terminalAgents.transcript", {
					workspaceId: input.workspaceId,
					terminalId: input.terminalId,
				})
				.catch(() => null);
			return { text: transcript?.text ?? null };
		}),

	execHostJob: workerProcedure
		.input(
			runIdSchema.extend({
				nodeId: z.string().min(1).max(64),
				attempt: z.number().int().positive(),
				hostId: z.string().min(1),
				workspaceId: z.string().min(1),
				command: z.string().min(1).max(100_000),
				maxRuntimeMs: z
					.number()
					.int()
					.positive()
					.max(24 * 60 * 60 * 1000),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const host = hostCaller(await hostRelay(scope, input.hostId));
			const job = await host.mutation<{ jobId: string; status: string }>(
				"agentJobs.exec",
				{
					// Replayed attempts reuse the job instead of starting a second one.
					callId: `${input.runId}:${input.nodeId}:${input.attempt}`,
					sessionId: jobSessionId(input.runId),
					workspaceId: input.workspaceId,
					command: input.command,
					maxRuntimeMs: input.maxRuntimeMs,
				},
			);
			return job;
		}),

	pollHostJob: workerProcedure
		.input(
			runIdSchema.extend({
				hostId: z.string().min(1),
				jobId: z.string().min(1),
				fromOffset: z.number().int().min(0),
				waitMs: z.number().int().min(0).max(25_000),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const host = hostCaller(await hostRelay(scope, input.hostId, 40_000));
			return host.mutation<{
				status: "running" | "done" | "failed" | "killed" | "timed_out" | "lost";
				chunk: string;
				nextOffset: number;
				exitCode: number | null;
			}>("agentJobs.output", {
				sessionId: jobSessionId(input.runId),
				jobId: input.jobId,
				fromOffset: input.fromOffset,
				waitMs: input.waitMs,
			});
		}),

	killHostJob: workerProcedure
		.input(
			runIdSchema.extend({
				hostId: z.string().min(1),
				jobId: z.string().min(1),
			}),
		)
		.mutation(async ({ input }) => {
			const scope = await runScope(input.runId);
			const host = hostCaller(await hostRelay(scope, input.hostId));
			await host
				.mutation("agentJobs.kill", {
					sessionId: jobSessionId(input.runId),
					jobId: input.jobId,
				})
				.catch(() => {});
			return { killed: true };
		}),

	/**
	 * LLM nodes run here rather than on the worker so model credentials stay
	 * on the API, the same trade generate-name.ts makes.
	 */
	llmCall: workerProcedure
		.input(
			runIdSchema.extend({
				prompt: z.string().min(1).max(100_000),
				system: z.string().max(20_000).optional(),
				model: z.string().min(1).max(128),
				effort: z.enum(workflowLlmEffortValues).optional(),
				maxTokens: z.number().int().min(1).max(64_000),
				jsonSchema: z.record(z.string(), z.unknown()).optional(),
			}),
		)
		.mutation(async ({ input }) => {
			await runScope(input.runId);
			const anthropic = new Anthropic({ apiKey: env.SERVER_ANTHROPIC_API_KEY });
			const ask = async (extra?: string) => {
				const response = await anthropic.messages.create({
					model: input.model,
					max_tokens: input.maxTokens,
					...workflowLlmEffortConfig(input.model, input.effort),
					...(input.system ? { system: input.system } : {}),
					messages: [
						{
							role: "user",
							content: [
								input.prompt,
								input.jsonSchema
									? `Answer with a single JSON value matching this JSON Schema, and nothing else:\n${JSON.stringify(input.jsonSchema)}`
									: null,
								extra ?? null,
							]
								.filter(Boolean)
								.join("\n\n"),
						},
					],
				});
				return response.content
					.filter(
						(block): block is Anthropic.TextBlock => block.type === "text",
					)
					.map((block) => block.text)
					.join("")
					.trim();
			};
			const text = await ask();
			if (!input.jsonSchema) return { text };
			const first = parseJson(text);
			if (first !== undefined) return { text, json: first };
			const retryText = await ask(
				"Your previous answer was not valid JSON. Answer again with only the JSON value.",
			);
			const second = parseJson(retryText);
			if (second === undefined) {
				throw new TRPCError({
					code: "UNPROCESSABLE_CONTENT",
					message: "Model did not return valid JSON.",
				});
			}
			return { text: retryText, json: second };
		}),
} satisfies TRPCRouterRecord;

function parseJson(text: string): unknown {
	const trimmed = text.replace(/^```(?:json)?\n?|```$/g, "").trim();
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

async function createNodeWorkspace(
	host: ReturnType<typeof hostCaller>,
	_runId: string,
	nodeId: string,
	projectId: string | null,
): Promise<string> {
	const name = `workflow ${nodeId}`.slice(0, 100);
	if (projectId === null) {
		const created = await host.mutation<{ workspace: { id: string } }>(
			"workspaces.createSession",
			{ name, tags: ["workflow"] },
		);
		return created.workspace.id;
	}
	const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
	const slug = slugifyForBranch(nodeId, 30);
	const branch = sanitizeBranchNameWithMaxLength(
		`${slug || "workflow"}-${timestamp}`,
		60,
	);
	const created = await host.mutation<{ workspace: { id: string } }>(
		"workspaces.create",
		{ projectId, name, branch, tags: ["workflow"] },
	);
	return created.workspace.id;
}

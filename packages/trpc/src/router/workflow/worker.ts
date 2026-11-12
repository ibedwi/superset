import Anthropic from "@anthropic-ai/sdk";
import { db } from "@superset/db/client";
import {
	workflowRunStatusValues,
	workflowStepStatusValues,
} from "@superset/db/enums";
import {
	workflowRunCheckpoints,
	workflowRunSteps,
	workflowRuns,
	workflowVersions,
} from "@superset/db/schema";
import { agentRunState } from "@superset/shared/agent-status";
import { CLOUD_HOST_ID } from "@superset/shared/host-routing";
import {
	workflowLlmEffortConfig,
	workflowLlmEffortValues,
} from "@superset/shared/workflow-graph";
import {
	sanitizeBranchNameWithMaxLength,
	slugifyForBranch,
} from "@superset/shared/workspace-launch";
import { TRPCError, type TRPCRouterRecord } from "@trpc/server";
import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../env";
import { nudge } from "../../lib/realtime";
import { workerProcedure } from "../../trpc";
import { RelayDispatchError } from "../automation/relay-client";
import {
	hostCaller,
	hostRelay,
	jobSessionId,
	killHostJob,
	runNotFound,
	runScope,
} from "./hostRelay";
import { assertRunActive } from "./runFinished";

const runIdSchema = z.object({ runId: z.string().uuid() });

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_RESULT_FILE_BYTES = 256 * 1024;

const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const MAX_CLAIM_LIMIT = 100;
const MAX_LEASE_SECONDS = 3600;

const leaseSchema = z.object({
	workerId: z.string().min(1).max(128),
	leaseSeconds: z.number().int().min(1).max(MAX_LEASE_SECONDS),
});

const agentRefSchema = z.object({
	kind: z.literal("agent"),
	hostId: z.string(),
	workspaceId: z.string(),
	terminalId: z.string(),
});

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
				.where(
					and(
						eq(workflowRuns.id, input.runId),
						inArray(workflowRuns.status, ACTIVE_RUN_STATUSES),
					),
				)
				.returning({ organizationId: workflowRuns.organizationId });
			if (!row) {
				await runScope(input.runId);
				return { recorded: false };
			}
			if (terminal) {
				await db
					.delete(workflowRunCheckpoints)
					.where(eq(workflowRunCheckpoints.runId, input.runId));
			}
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
			if (!ACTIVE_RUN_STATUSES.some((status) => status === scope.status)) {
				return { recorded: false };
			}
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

	loadCheckpoints: workerProcedure
		.input(runIdSchema)
		.mutation(async ({ input }) => {
			return db
				.select({
					key: workflowRunCheckpoints.key,
					result: workflowRunCheckpoints.result,
				})
				.from(workflowRunCheckpoints)
				.where(eq(workflowRunCheckpoints.runId, input.runId));
		}),

	saveCheckpoint: workerProcedure
		.input(
			runIdSchema.extend({
				key: z.string().min(1).max(256),
				result: z.unknown(),
			}),
		)
		.mutation(async ({ input }) => {
			const size = (JSON.stringify(input.result ?? null) ?? "null").length;
			if (size > MAX_CHECKPOINT_BYTES) {
				throw new TRPCError({
					code: "PAYLOAD_TOO_LARGE",
					message: "Checkpoint result is larger than 1 MB.",
				});
			}
			const scope = await runScope(input.runId);
			if (!ACTIVE_RUN_STATUSES.some((status) => status === scope.status)) {
				return { saved: false };
			}
			await db
				.insert(workflowRunCheckpoints)
				.values({
					runId: input.runId,
					key: input.key,
					result: input.result ?? null,
				})
				.onConflictDoNothing();
			return { saved: true };
		}),

	claimRuns: workerProcedure
		.input(
			leaseSchema.extend({
				limit: z.number().int().min(1).max(MAX_CLAIM_LIMIT),
			}),
		)
		.mutation(async ({ input }) => {
			const candidates = db
				.select({ id: workflowRuns.id })
				.from(workflowRuns)
				.where(
					and(
						eq(workflowRuns.engine, "postgres"),
						inArray(workflowRuns.status, ACTIVE_RUN_STATUSES),
						or(
							isNull(workflowRuns.leaseExpiresAt),
							lt(workflowRuns.leaseExpiresAt, sql`now()`),
						),
					),
				)
				.orderBy(asc(workflowRuns.createdAt))
				.limit(input.limit)
				.for("update", { skipLocked: true });
			const rows = await db
				.update(workflowRuns)
				.set({
					leaseOwner: input.workerId,
					leaseExpiresAt: sql`now() + make_interval(secs => ${input.leaseSeconds}::double precision)`,
				})
				.where(inArray(workflowRuns.id, candidates))
				.returning({ id: workflowRuns.id });
			return { runIds: rows.map((row) => row.id) };
		}),

	renewLease: workerProcedure
		.input(runIdSchema.extend(leaseSchema.shape))
		.mutation(async ({ input }) => {
			const rows = await db
				.update(workflowRuns)
				.set({
					leaseExpiresAt: sql`now() + make_interval(secs => ${input.leaseSeconds}::double precision)`,
				})
				.where(
					and(
						eq(workflowRuns.id, input.runId),
						eq(workflowRuns.leaseOwner, input.workerId),
						inArray(workflowRuns.status, ACTIVE_RUN_STATUSES),
					),
				)
				.returning({ id: workflowRuns.id });
			return { held: rows.length > 0 };
		}),

	releaseLease: workerProcedure
		.input(runIdSchema.extend({ workerId: z.string().min(1).max(128) }))
		.mutation(async ({ input }) => {
			await db
				.update(workflowRuns)
				.set({ leaseOwner: null, leaseExpiresAt: null })
				.where(
					and(
						eq(workflowRuns.id, input.runId),
						eq(workflowRuns.leaseOwner, input.workerId),
					),
				);
			return { released: true };
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
			const existing = await startedAgent(input.runId, input.nodeId);
			if (existing) return existing;
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
			const handle = {
				hostId: input.target.hostId,
				workspaceId,
				terminalId: session.sessionId,
			};
			await db
				.update(workflowRunSteps)
				.set({ externalRef: { kind: "agent", ...handle } })
				.where(
					and(
						eq(workflowRunSteps.runId, input.runId),
						eq(workflowRunSteps.nodeId, input.nodeId),
					),
				);
			return handle;
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
			assertRunActive(scope);
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
			await db
				.update(workflowRunSteps)
				.set({
					externalRef: {
						kind: "cli",
						hostId: input.hostId,
						jobId: job.jobId,
					},
				})
				.where(
					and(
						eq(workflowRunSteps.runId, input.runId),
						eq(workflowRunSteps.nodeId, input.nodeId),
					),
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
			assertRunActive(scope);
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
			await killHostJob({
				scope,
				hostId: input.hostId,
				jobId: input.jobId,
			});
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

async function startedAgent(runId: string, nodeId: string) {
	const [step] = await db
		.select({ externalRef: workflowRunSteps.externalRef })
		.from(workflowRunSteps)
		.where(
			and(
				eq(workflowRunSteps.runId, runId),
				eq(workflowRunSteps.nodeId, nodeId),
			),
		)
		.limit(1);
	const ref = agentRefSchema.safeParse(step?.externalRef);
	if (!ref.success) return null;
	const { hostId, workspaceId, terminalId } = ref.data;
	return { hostId, workspaceId, terminalId };
}

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

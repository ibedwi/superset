import { lookup } from "node:dns/promises";
import { assertPublicUrl, type ResolveHost } from "@superset/shared/ssrf";
import type {
	WorkflowGraph,
	WorkflowLlmEffort,
} from "@superset/shared/workflow-graph";
import type {
	AgentHandle,
	AgentState,
	JobStatus,
	WorkflowApi,
} from "../../clients/workflowApi";
import { NodeError } from "../../engines/nodeError";

export const RESULT_FILE_PATH = ".superset/workflow/result.json";

/** Appended to every agent node's prompt; capture reads this file first. */
export const RESULT_FILE_INSTRUCTION = `\n\nWhen you are completely finished, write your final result as a single JSON value to the file ${RESULT_FILE_PATH} in the workspace root (create the directory if needed). Keep it small: only the data a later workflow step needs.`;

const MAX_TEXT_OUTPUT = 32 * 1024;
const MAX_CLI_TAIL = 64 * 1024;
const MAX_HTTP_BODY = 256 * 1024;

export interface ActivityRuntime {
	heartbeat(): void;
	signal: AbortSignal;
	sleep(ms: number): Promise<void>;
}

const idleRuntime: ActivityRuntime = {
	heartbeat: () => {},
	signal: new AbortController().signal,
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export interface WorkflowActivityDeps {
	api: WorkflowApi;
	/** Engine hook for heartbeat, cancellation and sleep; defaults to a runtime that never aborts. */
	runtime?: () => ActivityRuntime;
	/** Injectable for tests; production resolves with the system resolver. */
	resolveHost?: ResolveHost;
	fetchFn?: typeof fetch;
	pollEveryMs?: number;
	/** How long an agent may stay "starting" before the node fails. */
	startTimeoutMs?: number;
	now?: () => number;
}

export interface AgentNodeOutput {
	json?: unknown;
	text: string;
}

export function createWorkflowActivities(deps: WorkflowActivityDeps) {
	const pollEveryMs = deps.pollEveryMs ?? 10_000;
	const startTimeoutMs = deps.startTimeoutMs ?? 2 * 60_000;
	const now = deps.now ?? Date.now;
	const fetchFn = deps.fetchFn ?? fetch;
	const runtime = deps.runtime ?? (() => idleRuntime);
	const throwIfCancelled = () => {
		if (runtime().signal.aborted) {
			throw new NodeError({
				message: "Activity cancelled",
				code: "Cancelled",
				retryable: false,
			});
		}
	};
	const resolveHost: ResolveHost =
		deps.resolveHost ??
		(async (hostname) =>
			(await lookup(hostname, { all: true })).map((entry) => entry.address));

	return {
		async loadWorkflowRun(input: { runId: string }): Promise<{
			graph: WorkflowGraph;
			triggerContext: unknown;
			title: string;
		}> {
			const run = await deps.api.loadRun(input);
			return {
				graph: run.graph,
				triggerContext: run.triggerContext,
				title: run.title,
			};
		},

		async recordRunStatus(input: {
			runId: string;
			status:
				| "pending"
				| "running"
				| "succeeded"
				| "failed"
				| "canceled"
				| "timed_out";
			error?: string | null;
		}): Promise<void> {
			await deps.api.recordRunStatus(input);
		},

		async recordStep(input: {
			runId: string;
			nodeId: string;
			nodeType: string;
			status:
				| "pending"
				| "running"
				| "succeeded"
				| "failed"
				| "skipped"
				| "canceled";
			input?: unknown;
			output?: unknown;
			error?: string | null;
			attempt?: number;
		}): Promise<void> {
			await deps.api.recordStep(input);
		},

		async dispatchAgentNode(input: {
			runId: string;
			nodeId: string;
			agent: string;
			model?: string;
			effort?: string;
			prompt: string;
			target: { hostId: string; v2ProjectId?: string };
		}): Promise<AgentHandle> {
			return deps.api.dispatchAgent({
				...input,
				prompt: input.prompt + RESULT_FILE_INSTRUCTION,
			});
		},

		/**
		 * Polls the agent until it settles or the budget is used, heartbeating
		 * so a worker loss hands the poll to another worker.
		 */
		async awaitAgentNode(input: {
			runId: string;
			handle: AgentHandle;
			budgetMs: number;
		}): Promise<{ settled: true; state: AgentState } | { settled: false }> {
			const startedAt = now();
			for (;;) {
				throwIfCancelled();
				runtime().heartbeat();
				const { state } = await deps.api.observeAgent({
					runId: input.runId,
					...input.handle,
				});
				if (state === "idle" || state === "exited" || state === "blocked") {
					return { settled: true, state };
				}
				const elapsedMs = now() - startedAt;
				// No hook event yet: the agent can sit on a startup prompt forever.
				if (state === "starting" && elapsedMs >= startTimeoutMs) {
					throw new NodeError({
						message: `Agent did not start within ${Math.round(startTimeoutMs / 1000)} s. It may be waiting for input in its terminal (workspace ${input.handle.workspaceId}).`,
						code: "AgentNotStarted",
						retryable: false,
					});
				}
				if (elapsedMs >= input.budgetMs) return { settled: false };
				await runtime().sleep(pollEveryMs);
			}
		},

		async captureAgentOutput(input: {
			runId: string;
			handle: AgentHandle;
		}): Promise<AgentNodeOutput> {
			const scoped = { runId: input.runId, ...input.handle };
			const file = await deps.api.readHostFile({
				runId: input.runId,
				hostId: input.handle.hostId,
				workspaceId: input.handle.workspaceId,
				path: RESULT_FILE_PATH,
			});
			if (file.found && file.base64 !== undefined) {
				const text = Buffer.from(file.base64, "base64").toString("utf8");
				try {
					return { json: JSON.parse(text) as unknown, text: cap(text) };
				} catch {
					return { text: cap(text) };
				}
			}
			const transcript = await deps.api.agentTranscript(scoped);
			return { text: cap(transcript.text ?? "") };
		},

		async execCliNode(input: {
			runId: string;
			nodeId: string;
			attempt: number;
			hostId: string;
			workspaceId: string;
			command: string;
			maxRuntimeMs: number;
		}): Promise<{ jobId: string }> {
			const job = await deps.api.execHostJob(input);
			return { jobId: job.jobId };
		},

		async pollCliNode(input: {
			runId: string;
			hostId: string;
			jobId: string;
			offset: number;
			budgetMs: number;
		}): Promise<{
			status: JobStatus;
			exitCode: number | null;
			tail: string;
			offset: number;
		}> {
			const startedAt = now();
			let offset = input.offset;
			let tail = "";
			for (;;) {
				throwIfCancelled();
				runtime().heartbeat();
				const output = await deps.api.pollHostJob({
					runId: input.runId,
					hostId: input.hostId,
					jobId: input.jobId,
					fromOffset: offset,
					waitMs: pollEveryMs,
				});
				offset = output.nextOffset;
				tail = (tail + output.chunk).slice(-MAX_CLI_TAIL);
				if (
					output.status !== "running" ||
					now() - startedAt >= input.budgetMs
				) {
					return {
						status: output.status,
						exitCode: output.exitCode,
						tail,
						offset,
					};
				}
			}
		},

		async killCliNode(input: {
			runId: string;
			hostId: string;
			jobId: string;
		}): Promise<void> {
			await deps.api.killHostJob(input);
		},

		async callLlmNode(input: {
			runId: string;
			prompt: string;
			system?: string;
			model: string;
			effort?: WorkflowLlmEffort;
			maxTokens: number;
			jsonSchema?: Record<string, unknown>;
		}): Promise<{ text: string; json?: unknown }> {
			return deps.api.llmCall(input);
		},

		async callHttpNode(input: {
			method: string;
			url: string;
			headers: Record<string, string>;
			body?: string;
			timeoutSeconds: number;
		}): Promise<{ status: number; body: string; json?: unknown }> {
			const url = await assertPublicUrl({
				url: input.url,
				resolveHost,
			}).catch((error: unknown) => {
				throw new NodeError({
					message: error instanceof Error ? error.message : String(error),
					code: "BadHttpNode",
					retryable: false,
				});
			});
			const response = await fetchFn(url, {
				method: input.method,
				headers: input.headers,
				...(input.body !== undefined &&
				input.method !== "GET" &&
				input.method !== "HEAD"
					? { body: input.body }
					: {}),
				redirect: "error",
				signal: AbortSignal.timeout(input.timeoutSeconds * 1000),
			});
			const body = (await response.text()).slice(0, MAX_HTTP_BODY);
			const json = parseJson(body);
			if (response.status >= 500) {
				throw new NodeError({
					message: `HTTP ${response.status} from ${url.hostname}`,
					code: "HttpNodeServerError",
					retryable: true,
				});
			}
			if (response.status >= 400) {
				throw new NodeError({
					message: `HTTP ${response.status} from ${url.hostname}: ${body.slice(0, 500)}`,
					code: "HttpNodeClientError",
					retryable: false,
				});
			}
			return {
				status: response.status,
				body,
				...(json !== undefined ? { json } : {}),
			};
		},
	};
}

export type WorkflowRunActivities = ReturnType<typeof createWorkflowActivities>;

function cap(text: string): string {
	return text.length > MAX_TEXT_OUTPUT ? text.slice(-MAX_TEXT_OUTPUT) : text;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
}

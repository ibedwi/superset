import type {
	WorkflowGraph,
	WorkflowLlmEffort,
} from "@superset/shared/workflow-graph";

// Mirrors the pgEnums in @superset/db; the worker must not pull the db client in.
export type WorkflowRunStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "canceled"
	| "timed_out";
export type WorkflowStepStatus =
	| "pending"
	| "running"
	| "succeeded"
	| "failed"
	| "skipped"
	| "canceled";

import { type TrpcCallOptions, trpcMutation } from "../trpcCall";

const WORKER_SECRET_HEADER = "x-agent-worker-secret";

export interface AgentHandle {
	hostId: string;
	workspaceId: string;
	terminalId: string;
}

export type AgentState = "starting" | "working" | "blocked" | "idle" | "exited";

export type JobStatus =
	| "running"
	| "done"
	| "failed"
	| "killed"
	| "timed_out"
	| "lost";

export interface LoadedRun {
	id: string;
	workflowId: string;
	organizationId: string;
	title: string;
	status: WorkflowRunStatus;
	triggerContext: unknown;
	graph: WorkflowGraph;
}

export interface WorkflowApi {
	loadRun(input: { runId: string }): Promise<LoadedRun>;
	recordRunStatus(input: {
		runId: string;
		status: WorkflowRunStatus;
		error?: string | null;
	}): Promise<unknown>;
	recordStep(input: {
		runId: string;
		nodeId: string;
		nodeType: string;
		status: WorkflowStepStatus;
		input?: unknown;
		output?: unknown;
		error?: string | null;
		attempt?: number;
	}): Promise<unknown>;
	dispatchAgent(input: {
		runId: string;
		nodeId: string;
		agent: string;
		model?: string;
		effort?: string;
		prompt: string;
		target: { hostId: string; v2ProjectId?: string };
	}): Promise<AgentHandle>;
	observeAgent(
		input: { runId: string } & AgentHandle,
	): Promise<{ state: AgentState }>;
	readHostFile(input: {
		runId: string;
		hostId: string;
		workspaceId: string;
		path: string;
	}): Promise<{ found: boolean; base64?: string }>;
	agentTranscript(
		input: { runId: string } & AgentHandle,
	): Promise<{ text: string | null }>;
	execHostJob(input: {
		runId: string;
		nodeId: string;
		attempt: number;
		hostId: string;
		workspaceId: string;
		command: string;
		maxRuntimeMs: number;
	}): Promise<{ jobId: string; status: string }>;
	pollHostJob(input: {
		runId: string;
		hostId: string;
		jobId: string;
		fromOffset: number;
		waitMs: number;
	}): Promise<{
		status: JobStatus;
		chunk: string;
		nextOffset: number;
		exitCode: number | null;
	}>;
	killHostJob(input: {
		runId: string;
		hostId: string;
		jobId: string;
	}): Promise<unknown>;
	loadCheckpoints(input: {
		runId: string;
	}): Promise<Array<{ key: string; result: unknown }>>;
	saveCheckpoint(input: {
		runId: string;
		key: string;
		result: unknown;
	}): Promise<unknown>;
	claimRuns(input: {
		workerId: string;
		limit: number;
		leaseSeconds: number;
	}): Promise<{ runIds: string[] }>;
	renewLease(input: {
		runId: string;
		workerId: string;
		leaseSeconds: number;
	}): Promise<{ held: boolean }>;
	releaseLease(input: { runId: string; workerId: string }): Promise<unknown>;
	llmCall(input: {
		runId: string;
		prompt: string;
		system?: string;
		model: string;
		effort?: WorkflowLlmEffort;
		maxTokens: number;
		jsonSchema?: Record<string, unknown>;
	}): Promise<{ text: string; json?: unknown }>;
}

/** The API's `workflowWorker` routes, called with the shared worker secret. */
export function workflowApi(options: {
	apiUrl: string;
	workerSecret: string;
	callOptions?: TrpcCallOptions;
}): WorkflowApi {
	const call = <T>(procedure: string, input: unknown) =>
		trpcMutation<T>(
			`${options.apiUrl}/api/trpc/workflowWorker.${procedure}`,
			{ [WORKER_SECRET_HEADER]: options.workerSecret },
			input,
			options.callOptions ?? {},
		);
	return {
		loadRun: (input) => call("loadRun", input),
		recordRunStatus: (input) => call("recordRunStatus", input),
		recordStep: (input) => call("recordStep", input),
		dispatchAgent: (input) => call("dispatchAgent", input),
		observeAgent: (input) => call("observeAgent", input),
		readHostFile: (input) => call("readHostFile", input),
		agentTranscript: (input) => call("agentTranscript", input),
		execHostJob: (input) => call("execHostJob", input),
		pollHostJob: (input) =>
			call("pollHostJob", { ...input, waitMs: Math.min(input.waitMs, 25_000) }),
		killHostJob: (input) => call("killHostJob", input),
		llmCall: (input) => call("llmCall", input),
		loadCheckpoints: (input) => call("loadCheckpoints", input),
		saveCheckpoint: (input) => call("saveCheckpoint", input),
		claimRuns: (input) => call("claimRuns", input),
		renewLease: (input) => call("renewLease", input),
		releaseLease: (input) => call("releaseLease", input),
	};
}

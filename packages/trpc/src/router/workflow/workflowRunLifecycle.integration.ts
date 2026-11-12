import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@superset/db/client";
import {
	organizations,
	users,
	workflowRunCheckpoints,
	workflowRunSteps,
	workflowRuns,
	workflows,
	workflowVersions,
} from "@superset/db/schema";
import { and, eq } from "drizzle-orm";
import {
	createCallerFactory,
	createTRPCContext,
	createTRPCRouter,
} from "../../trpc";
import { finalizeCanceledRun } from "./finalizeCanceledRun";
import { workflowWorkerRouter } from "./worker";

const ORG = crypto.randomUUID();
const USER = crypto.randomUUID();
const WORKFLOW = crypto.randomUUID();
const VERSION = crypto.randomUUID();
const suffix = Date.now();

const worker = createCallerFactory(
	createTRPCRouter({ workflowWorker: workflowWorkerRouter }),
)(
	createTRPCContext({
		session: null as never,
		auth: {} as never,
		headers: new Headers({
			"x-agent-worker-secret": process.env.AGENT_WORKER_SECRET ?? "",
		}),
	}),
).workflowWorker;

async function newRun(status: "pending" | "running" = "running") {
	const [run] = await db
		.insert(workflowRuns)
		.values({
			workflowId: WORKFLOW,
			organizationId: ORG,
			versionId: VERSION,
			title: "run",
			status,
		})
		.returning({ id: workflowRuns.id });
	if (!run) throw new Error("run not inserted");
	return run.id;
}

async function newStep(args: {
	runId: string;
	nodeId: string;
	status: "pending" | "running" | "succeeded";
	externalRef?: unknown;
}) {
	await db.insert(workflowRunSteps).values({
		runId: args.runId,
		nodeId: args.nodeId,
		nodeType: "cli",
		status: args.status,
		externalRef: args.externalRef ?? null,
	});
}

const stepStatus = async (runId: string, nodeId: string) =>
	(
		await db
			.select({ status: workflowRunSteps.status })
			.from(workflowRunSteps)
			.where(
				and(
					eq(workflowRunSteps.runId, runId),
					eq(workflowRunSteps.nodeId, nodeId),
				),
			)
	)[0]?.status;

const runStatus = async (runId: string) =>
	(
		await db
			.select({ status: workflowRuns.status })
			.from(workflowRuns)
			.where(eq(workflowRuns.id, runId))
	)[0]?.status;

beforeAll(async () => {
	await db
		.insert(organizations)
		.values({ id: ORG, name: "Run Org", slug: `run-org-${suffix}` });
	await db.insert(users).values({
		id: USER,
		name: "Run User",
		email: `run-${suffix}@example.com`,
		organizationIds: [ORG],
	});
	await db.insert(workflows).values({
		id: WORKFLOW,
		organizationId: ORG,
		ownerUserId: USER,
		name: "wf",
	});
	await db.insert(workflowVersions).values({
		id: VERSION,
		workflowId: WORKFLOW,
		authorUserId: USER,
		version: 1,
		graph: { nodes: [], edges: [] },
		contentHash: "hash",
	});
});

afterAll(async () => {
	await db.delete(organizations).where(eq(organizations.id, ORG));
	await db.delete(users).where(eq(users.id, USER));
});

describe("finalizeCanceledRun", () => {
	test("cancels the run and its active steps and kills the CLI job", async () => {
		const runId = await newRun();
		await newStep({
			runId,
			nodeId: "build",
			status: "running",
			externalRef: { kind: "cli", hostId: "host-1", jobId: "job-1" },
		});
		await newStep({ runId, nodeId: "done", status: "succeeded" });
		const killed: string[] = [];

		await finalizeCanceledRun({
			runId,
			killJob: async ({ jobId }) => {
				killed.push(jobId);
			},
		});

		expect(await runStatus(runId)).toBe("canceled");
		expect(await stepStatus(runId, "build")).toBe("canceled");
		expect(await stepStatus(runId, "done")).toBe("succeeded");
		expect(killed).toEqual(["job-1"]);
	});

	test("can be called twice", async () => {
		const runId = await newRun();
		await newStep({ runId, nodeId: "build", status: "running" });
		const killJob = async () => {};

		await finalizeCanceledRun({ runId, killJob });
		const second = await finalizeCanceledRun({ runId, killJob });

		expect(second.killedJobs).toBe(0);
		expect(await runStatus(runId)).toBe("canceled");
	});

	test("deletes the checkpoints of the run", async () => {
		const runId = await newRun();
		await db
			.insert(workflowRunCheckpoints)
			.values({ runId, key: "a:dispatch", result: { ok: true } });

		await finalizeCanceledRun({ runId, killJob: async () => {} });

		const left = await db
			.select()
			.from(workflowRunCheckpoints)
			.where(eq(workflowRunCheckpoints.runId, runId));
		expect(left).toHaveLength(0);
	});
});

describe("late worker writes", () => {
	test("recordStep after cancel leaves the step canceled", async () => {
		const runId = await newRun();
		await newStep({ runId, nodeId: "build", status: "running" });
		await finalizeCanceledRun({ runId, killJob: async () => {} });

		const result = await worker.recordStep({
			runId,
			nodeId: "build",
			nodeType: "cli",
			status: "succeeded",
		});

		expect(result.recorded).toBe(false);
		expect(await stepStatus(runId, "build")).toBe("canceled");
	});

	test("recordRunStatus after cancel leaves the run canceled", async () => {
		const runId = await newRun();
		await finalizeCanceledRun({ runId, killJob: async () => {} });

		const result = await worker.recordRunStatus({ runId, status: "succeeded" });

		expect(result.recorded).toBe(false);
		expect(await runStatus(runId)).toBe("canceled");
	});

	test("a terminal status deletes the checkpoints", async () => {
		const runId = await newRun();
		await db
			.insert(workflowRunCheckpoints)
			.values({ runId, key: "a:dispatch", result: null });

		await worker.recordRunStatus({ runId, status: "succeeded" });

		const left = await db
			.select()
			.from(workflowRunCheckpoints)
			.where(eq(workflowRunCheckpoints.runId, runId));
		expect(left).toHaveLength(0);
	});
});

describe("dispatchAgent", () => {
	test("returns the first handle for the same node", async () => {
		const runId = await newRun();
		const handle = {
			hostId: "host-1",
			workspaceId: "ws-1",
			terminalId: "term-1",
		};
		await newStep({
			runId,
			nodeId: "review",
			status: "running",
			externalRef: { kind: "agent", ...handle },
		});

		const result = await worker.dispatchAgent({
			runId,
			nodeId: "review",
			agent: "claude",
			prompt: "review it",
			target: { hostId: "host-1" },
		});

		expect(result).toEqual(handle);
	});
});

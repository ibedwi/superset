import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { db } from "@superset/db/client";
import {
	organizations,
	users,
	workflowRuns,
	workflows,
	workflowVersions,
} from "@superset/db/schema";
import { eq } from "drizzle-orm";
import {
	createCallerFactory,
	createTRPCContext,
	createTRPCRouter,
} from "../../trpc";
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

async function newRun(
	args: { status?: "pending" | "running" | "succeeded"; engine?: string } = {},
) {
	const [run] = await db
		.insert(workflowRuns)
		.values({
			workflowId: WORKFLOW,
			organizationId: ORG,
			versionId: VERSION,
			title: "run",
			status: args.status ?? "pending",
			engine: args.engine ?? "postgres",
		})
		.returning({ id: workflowRuns.id });
	if (!run) throw new Error("run not inserted");
	return run.id;
}

async function leaseOf(runId: string) {
	const [row] = await db
		.select({
			owner: workflowRuns.leaseOwner,
			expiresAt: workflowRuns.leaseExpiresAt,
		})
		.from(workflowRuns)
		.where(eq(workflowRuns.id, runId));
	return row;
}

beforeAll(async () => {
	await db
		.insert(organizations)
		.values({ id: ORG, name: "Engine Org", slug: `engine-org-${suffix}` });
	await db.insert(users).values({
		id: USER,
		name: "Engine User",
		email: `engine-${suffix}@example.com`,
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

describe("checkpoints", () => {
	test("loads what was saved", async () => {
		const runId = await newRun();
		await worker.saveCheckpoint({ runId, key: "a", result: { ok: 1 } });

		const rows = await worker.loadCheckpoints({ runId });

		expect(rows).toEqual([{ key: "a", result: { ok: 1 } }]);
	});

	test("a second save for the same key keeps the first result", async () => {
		const runId = await newRun();
		await worker.saveCheckpoint({ runId, key: "a", result: "first" });
		await worker.saveCheckpoint({ runId, key: "a", result: "second" });

		const rows = await worker.loadCheckpoints({ runId });

		expect(rows).toEqual([{ key: "a", result: "first" }]);
	});

	test("refuses a result larger than 1 MB", async () => {
		const runId = await newRun();

		await expect(
			worker.saveCheckpoint({
				runId,
				key: "big",
				result: "x".repeat(1024 * 1024 + 1),
			}),
		).rejects.toThrow(/1 MB/);
	});

	test("saves nothing for a finished run", async () => {
		const runId = await newRun({ status: "succeeded" });

		const result = await worker.saveCheckpoint({ runId, key: "a", result: 1 });

		expect(result.saved).toBe(false);
		expect(await worker.loadCheckpoints({ runId })).toEqual([]);
	});
});

describe("claimRuns", () => {
	test("two concurrent claims never return the same run", async () => {
		const created = await Promise.all(
			Array.from({ length: 12 }, () => newRun()),
		);

		const claims = await Promise.all(
			Array.from({ length: 4 }, (_, index) =>
				worker.claimRuns({
					workerId: `worker-${index}`,
					limit: 5,
					leaseSeconds: 60,
				}),
			),
		);

		const all = claims.flatMap((claim) => claim.runIds);
		expect(new Set(all).size).toBe(all.length);
		expect(all).toEqual(expect.arrayContaining(created));
	});

	test("skips runs of other engines and finished runs", async () => {
		const temporal = await newRun({ engine: "temporal" });
		const done = await newRun({ status: "succeeded" });

		const claim = await worker.claimRuns({
			workerId: "worker-skip",
			limit: 100,
			leaseSeconds: 60,
		});

		expect(claim.runIds).not.toContain(temporal);
		expect(claim.runIds).not.toContain(done);
	});

	test("takes over a run whose lease expired", async () => {
		const runId = await newRun({ status: "running" });
		await db
			.update(workflowRuns)
			.set({
				leaseOwner: "dead-worker",
				leaseExpiresAt: new Date(Date.now() - 1000),
			})
			.where(eq(workflowRuns.id, runId));

		const claim = await worker.claimRuns({
			workerId: "worker-new",
			limit: 100,
			leaseSeconds: 60,
		});

		expect(claim.runIds).toContain(runId);
		expect((await leaseOf(runId))?.owner).toBe("worker-new");
	});
});

describe("leases", () => {
	test("the owner renews and another worker does not", async () => {
		const runId = await newRun({ status: "running" });
		await db
			.update(workflowRuns)
			.set({
				leaseOwner: "owner",
				leaseExpiresAt: new Date(Date.now() + 1000),
			})
			.where(eq(workflowRuns.id, runId));

		const mine = await worker.renewLease({
			runId,
			workerId: "owner",
			leaseSeconds: 60,
		});
		const other = await worker.renewLease({
			runId,
			workerId: "other",
			leaseSeconds: 60,
		});

		expect(mine.held).toBe(true);
		expect(other.held).toBe(false);
	});

	test("renewal fails once the run is canceled", async () => {
		const runId = await newRun({ status: "running" });
		await db
			.update(workflowRuns)
			.set({ leaseOwner: "owner", status: "canceled" })
			.where(eq(workflowRuns.id, runId));

		const result = await worker.renewLease({
			runId,
			workerId: "owner",
			leaseSeconds: 60,
		});

		expect(result.held).toBe(false);
	});

	test("release clears the lease of the owner only", async () => {
		const runId = await newRun({ status: "running" });
		await db
			.update(workflowRuns)
			.set({ leaseOwner: "owner", leaseExpiresAt: new Date(Date.now() + 5000) })
			.where(eq(workflowRuns.id, runId));

		await worker.releaseLease({ runId, workerId: "other" });
		expect((await leaseOf(runId))?.owner).toBe("owner");
		await worker.releaseLease({ runId, workerId: "owner" });

		expect(await leaseOf(runId)).toEqual({ owner: null, expiresAt: null });
	});
});

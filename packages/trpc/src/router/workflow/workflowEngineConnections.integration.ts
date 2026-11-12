import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { db } from "@superset/db/client";
import {
	organizations,
	users,
	workflowEngineConnections,
	workflowRuns,
	workflows,
	workflowVersions,
} from "@superset/db/schema";
import { eq } from "drizzle-orm";
import { resolveWorkflowEngine } from "../../lib/workflow-engine";
import {
	connectionFromRow,
	findConnectionRow,
	sealCredentials,
	splitConnection,
} from "../../lib/workflow-engine/connections";
import {
	createCallerFactory,
	createTRPCContext,
	createTRPCRouter,
} from "../../trpc";
import { dispatchWorkflow } from "./dispatch";
import { loadRunConnection } from "./loadRunConnection";
import { workflowWorkerRouter } from "./worker";

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

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

async function storeConnection(
	draft: Parameters<typeof splitConnection>[0],
	options: { encryptedCredentials?: string } = {},
) {
	const parts = splitConnection(draft);
	const [row] = await db
		.insert(workflowEngineConnections)
		.values({
			organizationId: ORG,
			provider: parts.provider,
			config: parts.config,
			encryptedCredentials:
				options.encryptedCredentials ??
				sealCredentials({
					organizationId: ORG,
					credentials: parts.credentials,
				}),
		})
		.returning({ id: workflowEngineConnections.id });
	if (!row) throw new Error("connection not stored");
	return row.id;
}

const privateTemporal = {
	provider: "temporal" as const,
	address: "127.0.0.1:7244",
	namespace: "default",
	tls: false,
};

beforeAll(async () => {
	await db.insert(organizations).values({
		id: ORG,
		name: "Connection Org",
		slug: `connection-org-${suffix}`,
	});
	await db.insert(users).values({
		id: USER,
		name: "Connection User",
		email: `connection-${suffix}@example.com`,
		organizationIds: [ORG],
	});
	await db.insert(workflows).values({
		id: WORKFLOW,
		organizationId: ORG,
		ownerUserId: USER,
		name: "wf",
		liveVersionId: VERSION,
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

beforeEach(async () => {
	await db.delete(workflowRuns).where(eq(workflowRuns.organizationId, ORG));
	await db
		.delete(workflowEngineConnections)
		.where(eq(workflowEngineConnections.organizationId, ORG));
});

afterAll(async () => {
	await db.delete(organizations).where(eq(organizations.id, ORG));
	await db.delete(users).where(eq(users.id, USER));
});

describe("resolveWorkflowEngine with a stored connection", () => {
	test("returns the engine of the provider and the decrypted connection", async () => {
		await storeConnection({
			provider: "inngest",
			eventKey: "event-key-1234",
			signingKey: "signing-key-1234",
		});

		const resolved = await resolveWorkflowEngine({ organizationId: ORG });

		expect(resolved.engine.id).toBe("inngest");
		expect(resolved.connection).toMatchObject({
			provider: "inngest",
			eventKey: "event-key-1234",
		});
	});

	test("an organization without a connection gets none", async () => {
		const resolved = await resolveWorkflowEngine({ organizationId: ORG });

		expect(resolved.connection).toBeNull();
	});

	test("a connection that cannot be decrypted is an error, not a fallback", async () => {
		await storeConnection(privateTemporal, { encryptedCredentials: "bad" });

		await expect(
			resolveWorkflowEngine({ organizationId: ORG }),
		).rejects.toThrow(
			"temporal connection of this organization cannot be read",
		);
	});
});

describe("dispatchWorkflow with a connection", () => {
	test("records the connection and fails the run with a message naming it", async () => {
		const connectionId = await storeConnection(privateTemporal);

		const outcome = await dispatchWorkflow({
			workflow: {
				id: WORKFLOW,
				organizationId: ORG,
				name: "wf",
				liveVersionId: VERSION,
			},
		});

		const [run] = await db
			.select()
			.from(workflowRuns)
			.where(eq(workflowRuns.organizationId, ORG));
		expect(outcome.status).toBe("rejected");
		expect(run?.engine).toBe("temporal");
		expect(run?.engineConnectionId).toBe(connectionId);
		expect(run?.status).toBe("failed");
		expect(run?.error).toStartWith(
			"Could not start the run on your Temporal connection:",
		);
	});
});

describe("loadRunConnection", () => {
	test("returns the connection named on the run", async () => {
		const connectionId = await storeConnection(privateTemporal);

		const connection = await loadRunConnection(connectionId);

		expect(connection).toMatchObject({
			id: connectionId,
			provider: "temporal",
			address: "127.0.0.1:7244",
		});
	});

	test("returns null for a run without one", async () => {
		expect(await loadRunConnection(null)).toBeNull();
	});
});

describe("workflowWorker engine connections", () => {
	test("loadRun returns the run's connection id", async () => {
		const connectionId = await storeConnection(privateTemporal);
		const [run] = await db
			.insert(workflowRuns)
			.values({
				workflowId: WORKFLOW,
				organizationId: ORG,
				versionId: VERSION,
				title: "run",
				status: "pending",
				engine: "temporal",
				engineConnectionId: connectionId,
			})
			.returning({ id: workflowRuns.id });

		const loaded = await worker.loadRun({ runId: run?.id ?? "" });

		expect(loaded.engineConnectionId).toBe(connectionId);
	});

	test("listEngineConnections returns decrypted credentials", async () => {
		await storeConnection({
			...privateTemporal,
			tls: true,
			apiKey: "temporal-api-key-1234",
		});

		const connections = await worker.listEngineConnections();

		expect(connections.find((c) => c.provider === "temporal")).toMatchObject({
			address: "127.0.0.1:7244",
			apiKey: "temporal-api-key-1234",
		});
	});

	test("listEngineConnections marks a connection it cannot decrypt", async () => {
		const id = await storeConnection(privateTemporal, {
			encryptedCredentials: "bad",
		});

		const connections = await worker.listEngineConnections();

		const row = await findConnectionRow({ organizationId: ORG });
		expect(connections.some((c) => c.id === id)).toBe(false);
		expect(row?.status).toBe("error");
		expect(row?.lastError).toContain("cannot be read");
	});

	test("reportEngineConnection records connected for the current version", async () => {
		const id = await storeConnection(privateTemporal);
		const row = await findConnectionRow({ organizationId: ORG });

		const result = await worker.reportEngineConnection({
			connectionId: id,
			version: row?.version ?? "",
			status: "connected",
		});

		expect(result.recorded).toBe(true);
		expect((await findConnectionRow({ organizationId: ORG }))?.status).toBe(
			"connected",
		);
	});

	test("reportEngineConnection records the error text", async () => {
		const id = await storeConnection(privateTemporal);
		const row = await findConnectionRow({ organizationId: ORG });

		await worker.reportEngineConnection({
			connectionId: id,
			version: row?.version ?? "",
			status: "error",
			error: "namespace not found",
		});

		const after = await findConnectionRow({ organizationId: ORG });
		expect(after?.lastError).toBe("namespace not found");
	});

	test("reportEngineConnection ignores a report for an older version", async () => {
		const id = await storeConnection(privateTemporal);

		const result = await worker.reportEngineConnection({
			connectionId: id,
			version: "1999-01-01 00:00:00+00",
			status: "error",
			error: "stale",
		});

		expect(result.recorded).toBe(false);
		expect((await findConnectionRow({ organizationId: ORG }))?.status).toBe(
			"pending",
		);
	});

	test("a status report keeps the version the worker compares", async () => {
		const id = await storeConnection(privateTemporal);
		const before = await findConnectionRow({ organizationId: ORG });

		await worker.reportEngineConnection({
			connectionId: id,
			version: before?.version ?? "",
			status: "connected",
		});

		const after = await findConnectionRow({ organizationId: ORG });
		expect(after?.version).toBe(before?.version ?? "");
	});
});

describe("connectionFromRow", () => {
	test("rejects a row whose credentials belong to another organization", async () => {
		const parts = splitConnection(privateTemporal);
		const sealedForOther = sealCredentials({
			organizationId: crypto.randomUUID(),
			credentials: parts.credentials,
		});
		await storeConnection(privateTemporal, {
			encryptedCredentials: sealedForOther,
		});
		const row = await findConnectionRow({ organizationId: ORG });

		expect(() => connectionFromRow(row as NonNullable<typeof row>)).toThrow();
	});
});

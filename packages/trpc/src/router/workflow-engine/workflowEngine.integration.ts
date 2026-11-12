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
import { members } from "@superset/db/schema/auth";
import { eq } from "drizzle-orm";
import {
	createCallerFactory,
	createTRPCContext,
	createTRPCRouter,
} from "../../trpc";
import {
	createWorkflowEngineRouter,
	type WorkflowEngineRouterDeps,
} from "./workflowEngine";

process.env.SECRETS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const ORG = crypto.randomUUID();
const OWNER = crypto.randomUUID();
const ADMIN = crypto.randomUUID();
const MEMBER = crypto.randomUUID();
const OUTSIDER = crypto.randomUUID();
const WORKFLOW = crypto.randomUUID();
const VERSION = crypto.randomUUID();
const suffix = Date.now();

const EVENT_KEY = "evt-secret-key-ABCD1234";
const SIGNING_KEY = "sign-secret-key-WXYZ9876";
const API_KEY = "temporal-api-key-QRST5555";

const publicResolver = async () => ["93.184.216.34"];

function callerFor(args: {
	userId: string;
	deps?: Partial<WorkflowEngineRouterDeps>;
}) {
	const router = createWorkflowEngineRouter({
		testConnection: async () => {},
		resolveHost: publicResolver,
		...args.deps,
	});
	return createCallerFactory(createTRPCRouter({ workflowEngine: router }))(
		createTRPCContext({
			session: {
				user: { id: args.userId, email: `${args.userId}@example.com` },
				session: { activeOrganizationId: ORG },
			} as never,
			auth: {} as never,
			headers: new Headers(),
		}),
	).workflowEngine;
}

const owner = () => callerFor({ userId: OWNER });
const admin = () => callerFor({ userId: ADMIN });
const member = () => callerFor({ userId: MEMBER });

const inngestInput = {
	provider: "inngest" as const,
	eventKey: EVENT_KEY,
	signingKey: SIGNING_KEY,
};

const temporalInput = {
	provider: "temporal" as const,
	address: "temporal.example.com:7233",
	namespace: "acme.abc12",
	tls: true,
	apiKey: API_KEY,
};

const storedRow = async () =>
	(
		await db
			.select()
			.from(workflowEngineConnections)
			.where(eq(workflowEngineConnections.organizationId, ORG))
	)[0];

async function addRun(args: {
	connectionId: string;
	status: "pending" | "running" | "succeeded";
}) {
	await db.insert(workflowRuns).values({
		workflowId: WORKFLOW,
		organizationId: ORG,
		versionId: VERSION,
		title: "run",
		status: args.status,
		engine: "temporal",
		engineConnectionId: args.connectionId,
	});
}

beforeAll(async () => {
	await db
		.insert(organizations)
		.values({ id: ORG, name: "Engine Org", slug: `engine-conn-org-${suffix}` });
	await db.insert(users).values(
		[OWNER, ADMIN, MEMBER, OUTSIDER].map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			organizationIds: [ORG],
		})),
	);
	await db.insert(members).values([
		{ organizationId: ORG, userId: OWNER, role: "owner" },
		{ organizationId: ORG, userId: ADMIN, role: "admin" },
		{ organizationId: ORG, userId: MEMBER, role: "member" },
	]);
	await db.insert(workflows).values({
		id: WORKFLOW,
		organizationId: ORG,
		ownerUserId: OWNER,
		name: "wf",
	});
	await db.insert(workflowVersions).values({
		id: VERSION,
		workflowId: WORKFLOW,
		authorUserId: OWNER,
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
	await db.delete(users).where(eq(users.organizationIds, [ORG]));
});

describe("workflowEngine.connect", () => {
	test("an owner connects Inngest and the row starts pending", async () => {
		const { connection } = await owner().connect(inngestInput);

		expect(connection.provider).toBe("inngest");
		expect(connection.status).toBe("pending");
		expect((await storedRow())?.status).toBe("pending");
	});

	test("an admin may connect", async () => {
		const { connection } = await admin().connect(temporalInput);

		expect(connection.provider).toBe("temporal");
	});

	test("a member without the role is refused", async () => {
		await expect(member().connect(inngestInput)).rejects.toThrow(
			"Admin access required",
		);
	});

	test("a person outside the organization is refused", async () => {
		await expect(
			callerFor({ userId: OUTSIDER }).connect(inngestInput),
		).rejects.toThrow("Not a member");
	});

	test("secrets are stored encrypted", async () => {
		await owner().connect(temporalInput);

		const row = await storedRow();

		expect(JSON.stringify(row)).not.toContain(API_KEY);
		expect(row?.encryptedCredentials).toBeTruthy();
	});

	test("a failed credential test saves nothing new", async () => {
		await owner().connect(inngestInput);
		const before = await storedRow();
		const failing = callerFor({
			userId: OWNER,
			deps: {
				testConnection: async () => {
					throw new Error("401 invalid event key");
				},
			},
		});

		await expect(
			failing.connect({ ...inngestInput, eventKey: "another-event-key-0000" }),
		).rejects.toThrow("Could not connect to Inngest: 401 invalid event key");

		expect((await storedRow())?.encryptedCredentials).toBe(
			before?.encryptedCredentials ?? "",
		);
	});

	test("a private address is refused by default", async () => {
		const guarded = callerFor({
			userId: OWNER,
			deps: {
				allowPrivateHosts: () => false,
				resolveHost: async () => ["10.0.0.5"],
			},
		});

		await expect(
			guarded.connect({ ...temporalInput, address: "temporal.internal:7233" }),
		).rejects.toThrow(/forbidden address/);
	});

	test("a private address is accepted when the override is set", async () => {
		const permissive = callerFor({
			userId: OWNER,
			deps: {
				allowPrivateHosts: () => true,
				resolveHost: async () => ["10.0.0.5"],
			},
		});

		const { connection } = await permissive.connect({
			provider: "temporal",
			address: "localhost:7244",
			namespace: "default",
			tls: false,
		});

		expect(connection.provider).toBe("temporal");
	});

	test("refuses when the deployment has no secrets key", async () => {
		const keyless = callerFor({
			userId: OWNER,
			deps: { secretsConfigured: () => false },
		});

		await expect(keyless.connect(inngestInput)).rejects.toThrow(
			"SECRETS_ENCRYPTION_KEY is not set",
		);
	});

	test("refuses to replace a connection that has runs in flight", async () => {
		const { connection } = await owner().connect(inngestInput);
		await addRun({ connectionId: connection.id, status: "running" });

		await expect(owner().connect(inngestInput)).rejects.toThrow(
			"1 run is still in progress",
		);
	});
});

describe("workflowEngine.get", () => {
	test("returns no connection when none is stored", async () => {
		const result = await member().get();

		expect(result.connection).toBeNull();
	});

	test("any member can read, and never receives a secret", async () => {
		await owner().connect({ ...temporalInput });

		const result = await member().get();
		const text = JSON.stringify(result);

		expect(result.connection?.provider).toBe("temporal");
		expect(text).not.toContain(API_KEY);
		expect(text).not.toContain("encryptedCredentials");
	});

	test("shows only the last four characters of a secret", async () => {
		await owner().connect(inngestInput);

		const { connection } = await member().get();

		expect(connection?.secretHints).toEqual({
			eventKey: EVENT_KEY.slice(-4),
			signingKey: SIGNING_KEY.slice(-4),
		});
	});

	test("tells a member they cannot manage and an admin they can", async () => {
		expect((await member().get()).canManage).toBe(false);
		expect((await admin().get()).canManage).toBe(true);
	});

	test("reports the temporal authentication kind", async () => {
		await owner().connect(temporalInput);

		const { connection } = await member().get();

		expect(
			connection?.provider === "temporal" && connection.config.authentication,
		).toBe("api_key");
	});
});

describe("workflowEngine.test", () => {
	test("a passing check keeps the worker-reported status", async () => {
		await owner().connect(inngestInput);
		await db
			.update(workflowEngineConnections)
			.set({ status: "connected" })
			.where(eq(workflowEngineConnections.organizationId, ORG));

		const result = await owner().test();

		expect(result.ok).toBe(true);
		expect((await storedRow())?.status).toBe("connected");
	});

	test("a failing check returns the reason and keeps the status", async () => {
		await owner().connect(inngestInput);
		const failing = callerFor({
			userId: OWNER,
			deps: {
				testConnection: async () => {
					throw new Error("connection refused");
				},
			},
		});

		const result = await failing.test();

		expect(result.error).toBe("connection refused");
		expect((await storedRow())?.status).toBe("pending");
	});

	test("a passing check after an error asks the worker to retry", async () => {
		await owner().connect(inngestInput);
		const before = await storedRow();
		await db
			.update(workflowEngineConnections)
			.set({ status: "error", lastError: "boom" })
			.where(eq(workflowEngineConnections.organizationId, ORG));

		await owner().test();

		const after = await storedRow();
		expect(after?.status).toBe("pending");
		expect(after?.lastError).toBeNull();
		expect(after?.updatedAt.getTime()).toBeGreaterThanOrEqual(
			before?.updatedAt.getTime() ?? 0,
		);
	});

	test("a member cannot run the check", async () => {
		await expect(member().test()).rejects.toThrow("Admin access required");
	});
});

describe("workflowEngine.disconnect", () => {
	test("refuses while runs are in flight and reports how many", async () => {
		const { connection } = await owner().connect(inngestInput);
		await addRun({ connectionId: connection.id, status: "pending" });
		await addRun({ connectionId: connection.id, status: "running" });

		await expect(owner().disconnect()).rejects.toThrow(
			"2 runs are still in progress",
		);
	});

	test("removes the connection once the runs have ended", async () => {
		const { connection } = await owner().connect(inngestInput);
		await addRun({ connectionId: connection.id, status: "running" });
		await db
			.update(workflowRuns)
			.set({ status: "succeeded" })
			.where(eq(workflowRuns.organizationId, ORG));

		await owner().disconnect();

		expect(await storedRow()).toBeUndefined();
	});

	test("a member cannot disconnect", async () => {
		await expect(member().disconnect()).rejects.toThrow(
			"Admin access required",
		);
	});
});

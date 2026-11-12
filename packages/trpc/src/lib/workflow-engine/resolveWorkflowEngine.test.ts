import { describe, expect, test } from "bun:test";
import { assertTemporalAddress } from "./engines/temporal";
import {
	defaultWorkflowEngineId,
	resolveWorkflowEngine,
	workflowEngineById,
} from "./resolveWorkflowEngine";
import { WORKFLOW_ENGINE_IDS } from "./types";

describe("defaultWorkflowEngineId", () => {
	test("uses the configured engine", () => {
		expect(
			defaultWorkflowEngineId({
				configured: "inngest",
				temporalAddress: "localhost:7233",
			}),
		).toBe("inngest");
	});

	test("falls back to temporal when an address is set", () => {
		expect(
			defaultWorkflowEngineId({
				configured: undefined,
				temporalAddress: "localhost:7233",
			}),
		).toBe("temporal");
	});

	test("falls back to postgres without a temporal address", () => {
		expect(
			defaultWorkflowEngineId({
				configured: undefined,
				temporalAddress: undefined,
			}),
		).toBe("postgres");
	});
});

describe("workflowEngineById", () => {
	test("lists all four engines", () => {
		expect([...WORKFLOW_ENGINE_IDS]).toEqual([
			"temporal",
			"postgres",
			"inngest",
			"trigger",
		]);
	});

	test("returns the temporal adapter", () => {
		expect(workflowEngineById("temporal").id).toBe("temporal");
	});

	test("returns the postgres adapter", () => {
		expect(workflowEngineById("postgres").id).toBe("postgres");
	});

	test("returns the inngest adapter", () => {
		expect(workflowEngineById("inngest").id).toBe("inngest");
	});

	test("returns the trigger adapter", () => {
		expect(workflowEngineById("trigger").id).toBe("trigger");
	});

	test("temporal names the missing address", () => {
		expect(() => assertTemporalAddress({ address: undefined })).toThrow(
			"Workflow engine temporal is not configured: TEMPORAL_ADDRESS is not set.",
		);
	});

	test("inngest refuses to start without an event key", async () => {
		await expect(
			workflowEngineById("inngest").start({
				runId: "run-1",
				organizationId: "org-1",
				connection: null,
			}),
		).rejects.toThrow("INNGEST_EVENT_KEY is not set");
	});

	test("trigger refuses to start without a secret key", async () => {
		await expect(
			workflowEngineById("trigger").start({
				runId: "run-1",
				organizationId: "org-1",
				connection: null,
			}),
		).rejects.toThrow("TRIGGER_SECRET_KEY is not set");
	});

	test("names an unknown engine id", () => {
		expect(() => workflowEngineById("zeebe")).toThrow(/zeebe/);
	});
});

describe("resolveWorkflowEngine", () => {
	const inngestConnection = {
		id: "conn-1",
		provider: "inngest" as const,
		updatedAt: "1",
		eventKey: "event-key-1234",
		signingKey: "signing-key-1234",
	};

	test("prefers the organization's connection", async () => {
		const resolved = await resolveWorkflowEngine({
			organizationId: "org-1",
			loadConnection: async () => inngestConnection,
		});

		expect(resolved.engine.id).toBe("inngest");
		expect(resolved.connection).toEqual(inngestConnection);
	});

	test("uses the engine of the connection's provider", async () => {
		const resolved = await resolveWorkflowEngine({
			organizationId: "org-1",
			loadConnection: async () => ({
				id: "conn-2",
				provider: "temporal",
				updatedAt: "1",
				address: "temporal.example.com:7233",
				namespace: "ns",
				tls: true,
			}),
		});

		expect(resolved.engine.id).toBe("temporal");
	});

	test("uses the deployment engine and no connection without one", async () => {
		const resolved = await resolveWorkflowEngine({
			organizationId: "org-1",
			loadConnection: async () => null,
		});

		expect(resolved.connection).toBeNull();
	});

	test("passes the organization to the loader", async () => {
		let asked = "";
		await resolveWorkflowEngine({
			organizationId: "org-7",
			loadConnection: async ({ organizationId }) => {
				asked = organizationId;
				return null;
			},
		});

		expect(asked).toBe("org-7");
	});
});

describe("organization connections on the engines", () => {
	test("inngest refuses a Temporal connection", async () => {
		await expect(
			workflowEngineById("inngest").start({
				runId: "run-1",
				organizationId: "org-1",
				connection: {
					id: "conn-3",
					provider: "temporal",
					updatedAt: "1",
					address: "temporal.example.com:7233",
					namespace: "ns",
					tls: true,
				},
			}),
		).rejects.toThrow("is not an Inngest connection");
	});

	test("temporal refuses an Inngest connection", async () => {
		await expect(
			workflowEngineById("temporal").start({
				runId: "run-1",
				organizationId: "org-1",
				connection: {
					id: "conn-4",
					provider: "inngest",
					updatedAt: "1",
					eventKey: "event-key-1234",
					signingKey: "signing-key-1234",
				},
			}),
		).rejects.toThrow("is not a Temporal connection");
	});

	test("temporal refuses a connection on a private address", async () => {
		await expect(
			workflowEngineById("temporal").start({
				runId: "run-1",
				organizationId: "org-1",
				connection: {
					id: "conn-5",
					provider: "temporal",
					updatedAt: "1",
					address: "127.0.0.1:7233",
					namespace: "ns",
					tls: false,
				},
			}),
		).rejects.toThrow(/forbidden/);
	});
});

import { describe, expect, test } from "bun:test";
import {
	defaultWorkflowEngineId,
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

	test("inngest refuses to start without an event key", async () => {
		await expect(
			workflowEngineById("inngest").start({
				runId: "run-1",
				organizationId: "org-1",
			}),
		).rejects.toThrow("INNGEST_EVENT_KEY is not set");
	});

	test("trigger refuses to start without a secret key", async () => {
		await expect(
			workflowEngineById("trigger").start({
				runId: "run-1",
				organizationId: "org-1",
			}),
		).rejects.toThrow("TRIGGER_SECRET_KEY is not set");
	});

	test("names an unknown engine id", () => {
		expect(() => workflowEngineById("zeebe")).toThrow(/zeebe/);
	});
});

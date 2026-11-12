import { describe, expect, test } from "bun:test";
import { selectEngines } from "./engineSelection";

describe("selectEngines", () => {
	test("uses postgres when nothing is set", () => {
		expect(selectEngines({ env: {} })).toEqual({
			workflowEngine: "postgres",
			startTemporal: false,
			startPostgres: true,
			startInngest: false,
		});
	});

	test("uses temporal when only an address is set", () => {
		expect(selectEngines({ env: { TEMPORAL_ADDRESS: "t:7233" } })).toEqual({
			workflowEngine: "temporal",
			startTemporal: true,
			startPostgres: false,
			startInngest: false,
		});
	});

	test("starts temporal for Devs beside the postgres engine when an address is set", () => {
		const selection = selectEngines({
			env: { WORKFLOW_ENGINE: "postgres", TEMPORAL_ADDRESS: "t:7233" },
		});

		expect(selection.startTemporal).toBe(true);
		expect(selection.startPostgres).toBe(true);
	});

	test("starts temporal without an address when it is the configured engine", () => {
		const selection = selectEngines({ env: { WORKFLOW_ENGINE: "temporal" } });

		expect(selection.startTemporal).toBe(true);
	});

	test("does not start temporal for another engine without an address", () => {
		const selection = selectEngines({ env: { WORKFLOW_ENGINE: "inngest" } });

		expect(selection.startTemporal).toBe(false);
	});

	test("starts the inngest engine when it is configured", () => {
		const selection = selectEngines({ env: { WORKFLOW_ENGINE: "inngest" } });

		expect(selection.startInngest).toBe(true);
	});

	test("starts no engine process for trigger without an address", () => {
		const selection = selectEngines({ env: { WORKFLOW_ENGINE: "trigger" } });

		expect([
			selection.startTemporal,
			selection.startPostgres,
			selection.startInngest,
		]).toEqual([false, false, false]);
	});

	test("treats an empty value as unset", () => {
		const selection = selectEngines({ env: { WORKFLOW_ENGINE: "" } });

		expect(selection.workflowEngine).toBe("postgres");
	});

	test("names an unknown engine", () => {
		expect(() => selectEngines({ env: { WORKFLOW_ENGINE: "zeebe" } })).toThrow(
			/zeebe/,
		);
	});
});

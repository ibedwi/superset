import { describe, expect, test } from "bun:test";
import { readMaxTemporalConnections } from "./maxTemporalConnections";

describe("readMaxTemporalConnections", () => {
	test("is undefined when the variable is unset", () => {
		expect(readMaxTemporalConnections({ env: {} })).toBeUndefined();
	});

	test("is undefined when the variable is empty", () => {
		expect(
			readMaxTemporalConnections({
				env: { WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS: "" },
			}),
		).toBeUndefined();
	});

	test("reads a whole number", () => {
		expect(
			readMaxTemporalConnections({
				env: { WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS: "40" },
			}),
		).toBe(40);
	});

	test("allows zero to turn Temporal connections off", () => {
		expect(
			readMaxTemporalConnections({
				env: { WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS: "0" },
			}),
		).toBe(0);
	});

	test("refuses a value that is not a whole number", () => {
		expect(() =>
			readMaxTemporalConnections({
				env: { WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS: "many" },
			}),
		).toThrow("WORKFLOW_ENGINE_MAX_TEMPORAL_CONNECTIONS");
	});
});

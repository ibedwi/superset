import { describe, expect, test } from "bun:test";
import { assertRunActive, RUN_FINISHED_MESSAGE } from "./runFinished";

describe("assertRunActive", () => {
	test("accepts a pending run", () => {
		expect(() => assertRunActive({ status: "pending" })).not.toThrow();
	});

	test("accepts a running run", () => {
		expect(() => assertRunActive({ status: "running" })).not.toThrow();
	});

	test.each([
		"succeeded",
		"failed",
		"canceled",
		"timed_out",
	])("refuses a %s run with CONFLICT", (status) => {
		expect(() => assertRunActive({ status })).toThrow(RUN_FINISHED_MESSAGE);
	});
});

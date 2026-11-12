import { describe, expect, test } from "bun:test";
import { requireEngineEnv } from "./requireEnv";

describe("requireEngineEnv", () => {
	test("names the engine and the missing variable", () => {
		expect(() =>
			requireEngineEnv({
				env: {},
				engine: "inngest",
				name: "INNGEST_SIGNING_KEY",
			}),
		).toThrow(
			"Workflow engine inngest is not configured: INNGEST_SIGNING_KEY is not set.",
		);
	});

	test("treats an empty value as missing", () => {
		expect(() =>
			requireEngineEnv({
				env: { INNGEST_SIGNING_KEY: "" },
				engine: "inngest",
				name: "INNGEST_SIGNING_KEY",
			}),
		).toThrow("INNGEST_SIGNING_KEY is not set");
	});

	test("returns the value when set", () => {
		expect(
			requireEngineEnv({
				env: { INNGEST_SIGNING_KEY: "k" },
				engine: "inngest",
				name: "INNGEST_SIGNING_KEY",
			}),
		).toBe("k");
	});
});

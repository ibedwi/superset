import { describe, expect, it } from "bun:test";
import { engineRefetchInterval } from "./engineRefetchInterval";

describe("engineRefetchInterval", () => {
	it("polls every 2 seconds while the worker has not connected", () => {
		expect(engineRefetchInterval({ connection: { status: "pending" } })).toBe(
			2_000,
		);
	});

	it("stops polling otherwise", () => {
		expect(engineRefetchInterval({ connection: { status: "connected" } })).toBe(
			false,
		);
		expect(engineRefetchInterval({ connection: { status: "error" } })).toBe(
			false,
		);
		expect(engineRefetchInterval({ connection: null })).toBe(false);
		expect(engineRefetchInterval(undefined)).toBe(false);
	});
});

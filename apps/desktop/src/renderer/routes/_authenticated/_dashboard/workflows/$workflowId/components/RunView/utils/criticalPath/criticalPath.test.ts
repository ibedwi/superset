import { describe, expect, test } from "bun:test";
import { criticalPath, type StepTiming, timeInsight } from "./criticalPath";

const graph = {
	edges: [
		{ source: "trigger", target: "fetch" },
		{ source: "fetch", target: "summarize" },
		{ source: "fetch", target: "review" },
		{ source: "summarize", target: "post" },
		{ source: "review", target: "post" },
	],
};

const timing = new Map<string, StepTiming>([
	["trigger", { startMs: 1200, endMs: 1250 }],
	["fetch", { startMs: 1340, endMs: 2610 }],
	["summarize", { startMs: 2830, endMs: 11_400 }],
	["review", { startMs: 2830, endMs: 253_600 }],
	["skipped", { startMs: null, endMs: null }],
	["post", { startMs: 253_720, endMs: 254_500 }],
]);

describe("criticalPath", () => {
	test("follows the dependency that finished last", () => {
		expect(criticalPath(graph, timing)).toEqual([
			"trigger",
			"fetch",
			"review",
			"post",
		]);
	});

	test("is empty when nothing has finished", () => {
		expect(
			criticalPath(graph, new Map([["trigger", { startMs: 0, endMs: null }]])),
		).toEqual([]);
	});
});

describe("timeInsight", () => {
	test("names the longest step and the parallel step that waited", () => {
		const path = criticalPath(graph, timing);
		expect(timeInsight(graph, timing, path, 254_500)).toEqual({
			nodeId: "review",
			durationMs: 250_770,
			share: 250_770 / 254_500,
			waited: { nodeId: "summarize", endMs: 11_400 },
		});
	});

	test("has no waiting step on a straight chain", () => {
		const chain = new Map<string, StepTiming>([
			["trigger", { startMs: 0, endMs: 10 }],
			["fetch", { startMs: 20, endMs: 900 }],
		]);
		const insight = timeInsight(graph, chain, ["trigger", "fetch"], 900);
		expect(insight?.nodeId).toBe("fetch");
		expect(insight?.waited).toBeNull();
	});
});

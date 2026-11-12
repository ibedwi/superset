import { describe, expect, test } from "bun:test";
import { nodeDepths, timelineRowOrder } from "./rowOrder";

const graph = {
	nodes: [
		{ id: "post" },
		{ id: "review" },
		{ id: "summarize" },
		{ id: "trigger" },
		{ id: "fetch" },
	],
	edges: [
		{ source: "trigger", target: "fetch" },
		{ source: "fetch", target: "summarize" },
		{ source: "fetch", target: "review" },
		{ source: "summarize", target: "post" },
		{ source: "review", target: "post" },
	],
};

describe("nodeDepths", () => {
	test("uses the longest path from a root", () => {
		const depths = nodeDepths({
			nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
			edges: [
				{ source: "a", target: "b" },
				{ source: "b", target: "c" },
				{ source: "a", target: "c" },
			],
		});
		expect(depths.get("c")).toBe(2);
	});
});

describe("timelineRowOrder", () => {
	test("puts dependencies above the steps that need them", () => {
		expect(timelineRowOrder(graph, () => null)).toEqual([
			"trigger",
			"fetch",
			"review",
			"summarize",
			"post",
		]);
	});

	test("breaks ties at the same depth by start time", () => {
		const starts: Record<string, number> = { summarize: 10, review: 20 };
		expect(
			timelineRowOrder(graph, (id) => starts[id] ?? null).slice(2, 4),
		).toEqual(["summarize", "review"]);
	});

	test("puts started steps above unstarted ones at the same depth", () => {
		const starts: Record<string, number> = { summarize: 10 };
		expect(
			timelineRowOrder(graph, (id) => starts[id] ?? null).slice(2, 4),
		).toEqual(["summarize", "review"]);
	});
});

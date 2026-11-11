import { expect, test } from "bun:test";
import { upstreamNodeIds } from "./upstreamNodeIds";

test("collects transitive sources and ignores downstream and cycles", () => {
	const edges = [
		{ source: "trigger", target: "fetch" },
		{ source: "fetch", target: "check" },
		{ source: "check", target: "notify" },
		{ source: "notify", target: "check" },
	];
	expect([...upstreamNodeIds("check", edges)].sort()).toEqual([
		"fetch",
		"notify",
		"trigger",
	]);
	expect(upstreamNodeIds("trigger", edges).size).toBe(0);
});

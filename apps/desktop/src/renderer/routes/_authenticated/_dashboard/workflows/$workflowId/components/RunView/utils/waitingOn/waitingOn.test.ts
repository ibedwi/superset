import { describe, expect, test } from "bun:test";
import type { StepStatus } from "../../../../utils/graphMapping";
import { waitingOn } from "./waitingOn";

const graph = {
	edges: [
		{ source: "summarize", target: "post" },
		{ source: "review", target: "post" },
		{ source: "nothing", target: "post" },
	],
};

describe("waitingOn", () => {
	test("lists upstream steps that have not finished", () => {
		const statuses: Record<string, StepStatus> = {
			summarize: "succeeded",
			review: "running",
			nothing: "skipped",
		};
		expect(waitingOn(graph, "post", (id) => statuses[id] ?? "pending")).toEqual(
			["review"],
		);
	});

	test("is empty when every upstream step is done", () => {
		expect(waitingOn(graph, "post", () => "succeeded")).toEqual([]);
	});
});

import { describe, expect, test } from "bun:test";
import type { StepStatus } from "../../../../utils/graphMapping";
import { skipReason, skipReasonText } from "./skipReason";

const graph = {
	nodes: [
		{ id: "check", type: "condition" },
		{ id: "summarize", type: "llm" },
		{ id: "nothing", type: "cli" },
		{ id: "after-nothing", type: "http" },
	],
	edges: [
		{ source: "check", target: "summarize", sourceHandle: "true" as const },
		{ source: "check", target: "nothing", sourceHandle: "false" as const },
		{ source: "nothing", target: "after-nothing" },
	],
};

function steps(
	entries: Record<string, { status: StepStatus; output?: unknown }>,
) {
	return new Map(
		Object.entries(entries).map(([id, step]) => [
			id,
			{ status: step.status, output: step.output ?? null },
		]),
	);
}

const names: Record<string, string> = {
	check: "Any PRs open?",
	nothing: "Log nothing to do",
};
const nameOf = (id: string) => names[id] ?? id;

describe("skipReason", () => {
	test("names the condition and the branch it did not take", () => {
		const reason = skipReason(
			graph,
			"nothing",
			steps({
				check: { status: "succeeded", output: { result: true } },
				nothing: { status: "skipped" },
			}),
		);
		expect(reason).toEqual({
			kind: "branch",
			conditionId: "check",
			result: true,
			branch: "false",
		});
		expect(skipReasonText(reason, nameOf)).toBe(
			"Any PRs open? answered Yes, this step is on the No branch",
		);
	});

	test("points at a skipped upstream step", () => {
		const reason = skipReason(
			graph,
			"after-nothing",
			steps({
				check: { status: "succeeded", output: { result: true } },
				nothing: { status: "skipped" },
				"after-nothing": { status: "skipped" },
			}),
		);
		expect(skipReasonText(reason, nameOf)).toBe(
			"Log nothing to do was skipped",
		);
	});

	test("gives no reason when the condition output is missing", () => {
		const reason = skipReason(
			graph,
			"nothing",
			steps({ check: { status: "succeeded" }, nothing: { status: "skipped" } }),
		);
		expect(reason).toEqual({ kind: "unknown" });
		expect(skipReasonText(reason, nameOf)).toBeNull();
	});
});

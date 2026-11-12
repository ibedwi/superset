import { describe, expect, test } from "bun:test";
import { conditionText } from "./conditionText";

const nameOf = (id: string) => (id === "fetch" ? "Fetch open PRs" : id);

describe("conditionText", () => {
	test("describes a single comparison in words", () => {
		expect(
			conditionText(
				{
					left: { ref: "nodes.fetch.output.json.count" },
					op: "gt",
					right: { value: 0 },
				},
				nameOf,
			),
		).toBe("Fetch open PRs · count is greater than 0");
	});

	test("summarizes groups by size", () => {
		expect(
			conditionText(
				{
					any: [
						{ left: { value: 1 }, op: "truthy" },
						{ left: { value: 0 }, op: "truthy" },
					],
				},
				nameOf,
			),
		).toBe("Any of 2 checks pass");
	});

	test("is null when no expression is set", () => {
		expect(conditionText(undefined, nameOf)).toBeNull();
	});
});

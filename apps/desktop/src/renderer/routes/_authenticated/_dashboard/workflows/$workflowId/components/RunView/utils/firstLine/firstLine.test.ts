import { describe, expect, test } from "bun:test";
import { firstLine } from "./firstLine";

describe("firstLine", () => {
	test("returns the first non-empty line", () => {
		expect(firstLine("\n  HTTP 401 from slack.com  \nstack")).toBe(
			"HTTP 401 from slack.com",
		);
	});

	test("shortens long lines with an ellipsis", () => {
		expect(firstLine("abcdefghij", 6)).toBe("abcde…");
	});
});

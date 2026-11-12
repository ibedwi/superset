import { describe, expect, test } from "bun:test";
import { formatDuration } from "./formatDuration";

describe("formatDuration", () => {
	test("shows milliseconds under a second", () => {
		expect(formatDuration(40)).toBe("40ms");
		expect(formatDuration(0)).toBe("0ms");
	});

	test("shows one decimal under ten seconds", () => {
		expect(formatDuration(1270)).toBe("1.3s");
	});

	test("rounds to whole seconds under a minute", () => {
		expect(formatDuration(42_400)).toBe("42s");
	});

	test("combines minutes and seconds", () => {
		expect(formatDuration(251_000)).toBe("4m 11s");
		expect(formatDuration(120_000)).toBe("2m");
	});

	test("combines hours and minutes", () => {
		expect(formatDuration(3_900_000)).toBe("1h 5m");
	});

	test("treats negative input as zero", () => {
		expect(formatDuration(-5)).toBe("0ms");
	});
});

import { describe, expect, test } from "bun:test";
import { formatNextRun, nextDailyOccurrence } from "./scheduleTime";

describe("formatNextRun", () => {
	const now = new Date("2026-11-11T01:00:00Z");

	test("uses the calendar day of the schedule's timezone", () => {
		// 23:30 UTC on Nov 11 is already Nov 12 in Jakarta (UTC+7).
		const late = new Date("2026-11-11T23:30:00Z");
		expect(formatNextRun(late, now, "UTC", "en")).toBe("Today, 11:30 PM");
		expect(formatNextRun(late, now, "Asia/Jakarta", "en")).toBe(
			"Tomorrow, 6:30 AM",
		);
	});

	test("falls back to a full date beyond tomorrow", () => {
		const later = new Date("2026-11-14T02:00:00Z");
		expect(formatNextRun(later, now, "UTC", "en")).toContain("Nov 14");
	});
});

describe("nextDailyOccurrence", () => {
	const now = new Date(2026, 10, 11, 10, 0);

	test("is today when the time is still ahead", () => {
		expect(nextDailyOccurrence("17:00", now)).toEqual(
			new Date(2026, 10, 11, 17, 0),
		);
	});

	test("is tomorrow when the time has passed", () => {
		expect(nextDailyOccurrence("09:00", now)).toEqual(
			new Date(2026, 10, 12, 9, 0),
		);
	});

	test("rejects an incomplete time", () => {
		expect(nextDailyOccurrence("", now)).toBeNull();
	});
});

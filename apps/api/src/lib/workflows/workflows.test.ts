import { describe, expect, test } from "bun:test";
import { workflowDispatchBatch } from "./dispatchMatchingWorkflowTriggers";
import {
	planWorkflowSchedules,
	scheduleFromConfig,
} from "./evaluateWorkflowSchedules";

describe("workflowDispatchBatch", () => {
	test("builds one deduplicated message per matched trigger", () => {
		const batch = workflowDispatchBatch(
			[
				{ workflowId: "wf-1", triggerId: "t-1" },
				{ workflowId: "wf-2", triggerId: "t-2" },
			],
			"ev-1",
			"https://api.test",
		);
		expect(batch).toHaveLength(2);
		expect(batch[0]).toMatchObject({
			url: "https://api.test/api/workflows/dispatch/wf-1",
			body: { workflowId: "wf-1", triggerId: "t-1", eventId: "ev-1" },
			deduplicationId: "t-1_ev-1",
		});
	});
});

describe("scheduleFromConfig", () => {
	test("accepts a complete schedule config", () => {
		expect(
			scheduleFromConfig({
				kind: "schedule",
				rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
				dtstart: "2026-01-01T09:00:00.000Z",
				timezone: "UTC",
			}),
		).not.toBeNull();
	});

	test("declines null, wrong-kind, and incomplete configs", () => {
		expect(scheduleFromConfig(null)).toBeNull();
		expect(
			scheduleFromConfig({ kind: "webhook" } as Parameters<
				typeof scheduleFromConfig
			>[0]),
		).toBeNull();
		expect(
			scheduleFromConfig({
				kind: "schedule",
				rrule: "",
				dtstart: "2026-01-01T09:00:00.000Z",
				timezone: "UTC",
			}),
		).toBeNull();
	});
});

describe("planWorkflowSchedules", () => {
	const config = {
		kind: "schedule" as const,
		rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
		dtstart: "2026-01-01T09:00:00.000Z",
		timezone: "UTC",
	};

	test("buckets scheduledFor to the minute and advances next_run_at", () => {
		const due = new Date("2026-01-05T09:00:42.500Z");
		const { planned, unusable } = planWorkflowSchedules([
			{ workflowId: "wf-1", triggerId: "t-1", nextRunAt: due, config },
		]);
		expect(unusable).toHaveLength(0);
		expect(planned).toHaveLength(1);
		expect(planned[0]?.scheduledFor.toISOString()).toBe(
			"2026-01-05T09:00:00.000Z",
		);
		expect(planned[0]?.next).not.toBeNull();
		expect(planned[0]?.next?.getTime()).toBeGreaterThan(due.getTime());
	});

	test("an unusable config is reported, not planned", () => {
		const { planned, unusable } = planWorkflowSchedules([
			{
				workflowId: "wf-1",
				triggerId: "t-1",
				nextRunAt: new Date(),
				config: null,
			},
		]);
		expect(planned).toHaveLength(0);
		expect(unusable).toEqual([
			{ workflowId: "wf-1", reason: "schedule trigger config is unusable" },
		]);
	});
});

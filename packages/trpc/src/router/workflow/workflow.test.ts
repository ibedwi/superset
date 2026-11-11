import { describe, expect, test } from "bun:test";
import { TRPCError } from "@trpc/server";
import { graphContentHash, parseGraphForSave } from "./graph";
import { pageRuns } from "./run";
import { assertTriggerSaveable, nextRunAtFor } from "./trigger";

const validGraph = {
	nodes: [
		{ id: "start", type: "trigger", position: { x: 0, y: 0 }, config: {} },
		{
			id: "build",
			type: "agent",
			position: { x: 200, y: 0 },
			config: {
				agent: "claude",
				prompt: "do it",
				target: { hostId: "cloud" },
				timeoutMinutes: 60,
			},
		},
	],
	edges: [{ id: "e1", source: "start", target: "build" }],
};

describe("parseGraphForSave", () => {
	test("accepts a strict valid graph", () => {
		const graph = parseGraphForSave(validGraph);
		expect(graph.nodes).toHaveLength(2);
	});

	test("rejects a draft-only graph (missing prompt)", () => {
		const draft = {
			...validGraph,
			nodes: [
				validGraph.nodes[0],
				{ id: "build", type: "agent", position: { x: 1, y: 1 }, config: {} },
			],
		};
		expect(() => parseGraphForSave(draft)).toThrow(TRPCError);
	});

	test("rejects a structurally broken graph (cycle)", () => {
		const cyclic = {
			...validGraph,
			edges: [
				...validGraph.edges,
				{ id: "e2", source: "build", target: "build" },
			],
		};
		expect(() => parseGraphForSave(cyclic)).toThrow(/cycle/);
	});
});

describe("graphContentHash", () => {
	test("is stable for identical graphs and differs on change", () => {
		const a = parseGraphForSave(validGraph);
		const b = parseGraphForSave(validGraph);
		expect(graphContentHash(a)).toBe(graphContentHash(b));
		const edited = parseGraphForSave({
			...validGraph,
			nodes: validGraph.nodes.map((node) =>
				node.id === "build"
					? { ...node, config: { ...node.config, prompt: "do it differently" } }
					: node,
			),
		});
		expect(graphContentHash(edited)).not.toBe(graphContentHash(a));
	});
});

describe("pageRuns", () => {
	const row = (id: string, cursorAt: string) => ({ id, cursorAt });

	test("returns no cursor when the page is not full", () => {
		const { page, nextCursor } = pageRuns([row("a", "1"), row("b", "2")], 5);
		expect(page).toHaveLength(2);
		expect(nextCursor).toBeNull();
	});

	test("trims the probe row and points the cursor at the last returned row", () => {
		const rows = [row("a", "3"), row("b", "2"), row("c", "1")];
		const { page, nextCursor } = pageRuns(rows, 2);
		expect(page.map((r) => r.id)).toEqual(["a", "b"]);
		expect(nextCursor).toEqual({ createdAt: "2", id: "b" });
	});
});

describe("assertTriggerSaveable", () => {
	test("accepts a valid schedule trigger", () => {
		expect(() =>
			assertTriggerSaveable({
				config: {
					kind: "schedule",
					rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
					dtstart: new Date("2026-01-01T09:00:00Z").toISOString(),
					timezone: "UTC",
				},
			}),
		).not.toThrow();
	});

	test("rejects an unconfigured trigger with the form's wording", () => {
		expect(() =>
			assertTriggerSaveable({
				config: { kind: "schedule", rrule: "", dtstart: "", timezone: "" },
			}),
		).toThrow(TRPCError);
	});
});

describe("nextRunAtFor", () => {
	test("event kinds have no next run", () => {
		expect(
			nextRunAtFor({
				kind: "webhook",
			} as Parameters<typeof nextRunAtFor>[0]),
		).toBeNull();
	});

	test("schedules advance past the reference time", () => {
		const after = new Date("2026-01-10T10:00:00Z");
		const next = nextRunAtFor(
			{
				kind: "schedule",
				rrule: "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
				dtstart: new Date("2026-01-01T09:00:00Z").toISOString(),
				timezone: "UTC",
			},
			after,
		);
		expect(next).not.toBeNull();
		expect(next?.getTime()).toBeGreaterThan(after.getTime());
	});
});

import { describe, expect, test } from "bun:test";
import {
	barGeometry,
	createTimeScale,
	MIN_BAR_PX,
	pickTickStep,
	placeLabel,
	tickValues,
} from "./timeScale";

describe("pickTickStep", () => {
	test("picks a round step that keeps labels apart", () => {
		expect(pickTickStep(255_000, 800)).toBe(30_000);
	});

	test("uses smaller steps when zoomed in", () => {
		expect(pickTickStep(255_000, 800 * 16)).toBe(2000);
	});

	test("handles sub-second runs", () => {
		expect(pickTickStep(300, 600)).toBe(50);
	});
});

describe("tickValues", () => {
	test("starts at zero and stays inside the total", () => {
		expect(tickValues(95_000, 30_000)).toEqual([0, 30_000, 60_000, 90_000]);
	});
});

describe("createTimeScale", () => {
	test("maps time linearly across the width", () => {
		const scale = createTimeScale(1000, 500, 8);
		expect(scale.x(0)).toBe(8);
		expect(scale.x(500)).toBe(258);
		expect(scale.x(1000)).toBe(508);
	});
});

describe("barGeometry", () => {
	test("keeps a minimum width for very short steps", () => {
		const scale = createTimeScale(240_000, 600, 0);
		expect(barGeometry(scale, 1000, 1040).width).toBe(MIN_BAR_PX);
	});
});

describe("placeLabel", () => {
	test("puts the label after the bar when it fits", () => {
		expect(
			placeLabel({
				startPx: 10,
				endPx: 50,
				textPx: 40,
				trackPx: 300,
				hasBar: true,
			}),
		).toEqual({ left: 58 });
	});

	test("flips the label before the bar near the right edge", () => {
		expect(
			placeLabel({
				startPx: 200,
				endPx: 280,
				textPx: 40,
				trackPx: 300,
				hasBar: true,
			}),
		).toEqual({ right: 108 });
	});

	test("puts the label inside a bar that spans the whole track", () => {
		expect(
			placeLabel({
				startPx: 10,
				endPx: 280,
				textPx: 40,
				trackPx: 300,
				hasBar: true,
			}),
		).toEqual({ inside: 18 });
	});

	test("lets a label without a bar run into the scrolled area", () => {
		expect(
			placeLabel({
				startPx: 10,
				endPx: 34,
				textPx: 400,
				trackPx: 300,
				hasBar: false,
			}),
		).toEqual({ left: 42 });
	});
});

export const MIN_BAR_PX = 3;
export const LABEL_GAP_PX = 8;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 64;

const TICK_STEPS_MS = [
	1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000,
	60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000, 7_200_000,
	21_600_000, 43_200_000, 86_400_000,
];

/** The smallest round step that keeps axis labels at least `minGapPx` apart. */
export function pickTickStep(
	totalMs: number,
	widthPx: number,
	minGapPx = 72,
): number {
	const msPerPx = Math.max(totalMs, 1) / Math.max(widthPx, 1);
	return (
		TICK_STEPS_MS.find((step) => step / msPerPx >= minGapPx) ??
		(TICK_STEPS_MS.at(-1) as number)
	);
}

export function tickValues(totalMs: number, stepMs: number): number[] {
	const ticks: number[] = [];
	for (let t = 0; t <= totalMs; t += stepMs) ticks.push(t);
	return ticks;
}

export interface TimeScale {
	x: (ms: number) => number;
	widthPx: number;
}

/** Linear: `x(0)` is `insetPx`, `x(totalMs)` is `insetPx + widthPx`. */
export function createTimeScale(
	totalMs: number,
	widthPx: number,
	insetPx: number,
): TimeScale {
	const total = Math.max(totalMs, 1);
	return { x: (ms) => insetPx + (ms / total) * widthPx, widthPx };
}

export function barGeometry(
	scale: TimeScale,
	startMs: number,
	endMs: number,
): { left: number; width: number } {
	const left = scale.x(startMs);
	return { left, width: Math.max(MIN_BAR_PX, scale.x(endMs) - left) };
}

export type LabelPosition =
	| { left: number }
	| { right: number }
	| { inside: number };

/**
 * Puts a label after its bar, before the bar when it would run past the track,
 * or, when neither side has room, inside the bar (or after it, into the
 * scrolled area, when there is no bar). `right` is measured from the track's
 * right edge.
 */
export function placeLabel({
	startPx,
	endPx,
	textPx,
	trackPx,
	hasBar,
}: {
	startPx: number;
	endPx: number;
	textPx: number;
	trackPx: number;
	hasBar: boolean;
}): LabelPosition {
	if (endPx + LABEL_GAP_PX + textPx <= trackPx) {
		return { left: endPx + LABEL_GAP_PX };
	}
	if (startPx - LABEL_GAP_PX - textPx >= 0) {
		return { right: trackPx - startPx + LABEL_GAP_PX };
	}
	return hasBar
		? { inside: startPx + LABEL_GAP_PX }
		: { left: endPx + LABEL_GAP_PX };
}

/** Width of 11px monospace text, close enough to decide on which side it fits. */
export function estimateTextPx(text: string): number {
	return text.length * 6.7;
}

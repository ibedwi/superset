import { formatDate, formatNumber } from "@superset/i18n/format";

function unit(value: number, name: string, maximumFractionDigits = 0): string {
	return formatNumber(value, {
		style: "unit",
		unit: name,
		unitDisplay: "narrow",
		maximumFractionDigits,
	});
}

/** 40 → "40ms", 1270 → "1.3s", 251_000 → "4m 11s". */
export function formatDuration(ms: number): string {
	const safe = Math.max(0, ms);
	if (safe < 1000) return unit(Math.round(safe), "millisecond");
	if (safe < 10_000) return unit(safe / 1000, "second", 1);
	const totalSeconds = Math.round(safe / 1000);
	if (totalSeconds < 60) return unit(totalSeconds, "second");
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (hours > 0) {
		return minutes > 0
			? `${unit(hours, "hour")} ${unit(minutes, "minute")}`
			: unit(hours, "hour");
	}
	return seconds > 0
		? `${unit(minutes, "minute")} ${unit(seconds, "second")}`
		: unit(minutes, "minute");
}

/** Wall-clock time with milliseconds, for telling apart steps that start together. */
export function formatClockWithMs(date: Date | number): string {
	return formatDate(date, {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit",
		fractionalSecondDigits: 3,
	});
}

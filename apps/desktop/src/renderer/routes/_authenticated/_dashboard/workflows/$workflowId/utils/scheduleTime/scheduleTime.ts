import { msg } from "@lingui/core/macro";
import { i18n } from "@superset/i18n";
import { formatDate, getActiveLocale } from "@superset/i18n/format";

const DAY_MS = 24 * 60 * 60 * 1000;

function calendarDay(date: Date, timeZone: string | undefined): number {
	const parts = new Intl.DateTimeFormat(getActiveLocale(), {
		timeZone,
		numberingSystem: "latn",
		calendar: "gregory",
		year: "numeric",
		month: "numeric",
		day: "numeric",
	}).formatToParts(date);
	const part = (type: string) =>
		Number(parts.find((candidate) => candidate.type === type)?.value);
	return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY_MS;
}

/** "Today, 09:00", "Tomorrow, 17:00", else "Thu, Nov 13, 09:00" — in `timeZone`. */
export function formatNextRun(
	date: Date,
	now: Date,
	timeZone?: string,
	locale = getActiveLocale(),
): string {
	const dayOffset = calendarDay(date, timeZone) - calendarDay(now, timeZone);
	if (dayOffset === 0 || dayOffset === 1) {
		const day = new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
			dayOffset,
			"day",
		);
		const time = formatDate(
			date,
			{ hour: "numeric", minute: "2-digit", timeZone },
			locale,
		);
		return i18n._({
			...msg({ message: "{day}, {time}" }),
			values: {
				day: day.charAt(0).toLocaleUpperCase(locale) + day.slice(1),
				time,
			},
		});
	}
	return formatDate(
		date,
		{
			weekday: "short",
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
			timeZone,
		},
		locale,
	);
}

/** "WIB", "GMT+7" — whatever short name the locale has for the zone. */
export function timeZoneShortName(
	timeZone: string,
	date = new Date(),
	locale = getActiveLocale(),
): string {
	try {
		return (
			new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
				.formatToParts(date)
				.find((part) => part.type === "timeZoneName")?.value ?? timeZone
		);
	} catch {
		return timeZone;
	}
}

export function timeZoneLabel(timeZone: string, date = new Date()): string {
	const short = timeZoneShortName(timeZone, date);
	return short === timeZone ? timeZone : `${timeZone} · ${short}`;
}

interface ScheduledTrigger {
	config: { kind: string; timezone?: string };
	nextRunAt: Date | string | null;
}

export function earliestNextRun(
	triggers: readonly ScheduledTrigger[],
): { at: Date; timeZone: string | undefined } | null {
	let earliest: { at: Date; timeZone: string | undefined } | null = null;
	for (const trigger of triggers) {
		if (trigger.config.kind !== "schedule" || !trigger.nextRunAt) continue;
		const at = new Date(trigger.nextRunAt);
		if (!earliest || at < earliest.at) {
			earliest = { at, timeZone: trigger.config.timezone };
		}
	}
	return earliest;
}

/** The first run a new daily schedule at `time` ("HH:MM") would make. */
export function nextDailyOccurrence(time: string, now: Date): Date | null {
	const match = /^(\d{1,2}):(\d{2})$/.exec(time);
	if (!match) return null;
	const next = new Date(now);
	next.setHours(Number(match[1]), Number(match[2]), 0, 0);
	if (next <= now) next.setDate(next.getDate() + 1);
	return next;
}

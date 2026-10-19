/**
 * Family schedule from one or more iCal (.ics) feeds, e.g. a Google Calendar
 * "secret address in iCal format", Nextcloud, or iCloud public calendar.
 *
 * CALENDAR_FEEDS="Family|https://...ics, Kids sports|https://...ics"
 * Feeds are fetched server-side and cached for CALENDAR_CACHE_MINUTES.
 */
import ical, { type VEvent } from "node-ical";

export interface ScheduleItem {
	title: string;
	calendar: string;
	start: Date;
	end: Date;
	allDay: boolean;
	location?: string;
}

// How far ahead feeds are fetched; each user picks how much of it to show.
const DAYS_AHEAD = Number(process.env.CALENDAR_DAYS_AHEAD ?? 31);
const CACHE_MS = Number(process.env.CALENDAR_CACHE_MINUTES ?? 10) * 60_000;

let cache: { at: number; items: ScheduleItem[] } | null = null;

function feeds(): Array<{ name: string; url: string }> {
	return (process.env.CALENDAR_FEEDS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((entry) => {
			const [name, url] = entry.includes("|") ? entry.split("|", 2) : ["Family", entry];
			return { name: name.trim(), url: url.trim().replace(/^webcal:/, "https:") };
		});
}

const text = (v: unknown) =>
	typeof v === "string" ? v : v && typeof v === "object" && "val" in v ? String((v as any).val) : "";

async function loadFeed(feed: { name: string; url: string }, from: Date, to: Date) {
	const data = await ical.async.fromURL(feed.url);
	const items: ScheduleItem[] = [];
	for (const component of Object.values(data)) {
		if (!component || component.type !== "VEVENT") continue;
		const event = component as VEvent;
		// Overrides are applied through their parent event's `recurrences`.
		if ((event as any).recurrenceid) continue;
		for (const inst of ical.expandRecurringEvent(event, { from, to, expandOngoing: true })) {
			items.push({
				title: text(inst.summary) || "Busy",
				calendar: feed.name,
				start: inst.start,
				end: inst.end,
				allDay: inst.isFullDay,
				location: text(inst.event.location) || undefined,
			});
		}
	}
	return items;
}

export function scheduleEnabled(): boolean {
	return feeds().length > 0;
}

export async function getSchedule(): Promise<ScheduleItem[]> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.items;

	const from = new Date();
	from.setHours(0, 0, 0, 0);
	const to = new Date(from.getTime() + DAYS_AHEAD * 86_400_000);

	const results = await Promise.allSettled(feeds().map((f) => loadFeed(f, from, to)));
	results.forEach((r, i) => {
		if (r.status === "rejected") console.warn(`[family-hub] Calendar "${feeds()[i].name}" failed:`, r.reason?.message);
	});
	const items = results
		.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	// Keep serving stale data if every feed failed this time.
	if (items.length || !cache) cache = { at: Date.now(), items };
	return cache.items;
}

/** Upper bound for a user's "days to show" choice. */
export const maxScheduleDays = () => DAYS_AHEAD;

/** Groups items by local calendar day (in SITE_TIMEZONE), for `days` days starting today. */
export function groupByDay(items: ScheduleItem[], days = DAYS_AHEAD) {
	const tz = process.env.SITE_TIMEZONE || process.env.TZ || "America/Chicago";
	const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
	const todayKey = dayKey.format(new Date());
	const tomorrowKey = dayKey.format(new Date(Date.now() + 86_400_000));
	const endKey = dayKey.format(new Date(Date.now() + days * 86_400_000));
	const label = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
	const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });

	const byDay = new Map<string, { label: string; items: Array<ScheduleItem & { time: string }> }>();
	for (const item of items) {
		// All-day events are date-only; format them in UTC so they don't slip a day.
		const key = item.allDay ? item.start.toISOString().slice(0, 10) : dayKey.format(item.start);
		if (key < todayKey || key >= endKey) continue;
		if (!byDay.has(key)) {
			const pretty = key === todayKey ? "Today" : key === tomorrowKey ? "Tomorrow" : label.format(new Date(`${key}T12:00:00Z`));
			byDay.set(key, { label: pretty, items: [] });
		}
		byDay.get(key)!.items.push({ ...item, time: item.allDay ? "All day" : time.format(item.start) });
	}
	return [...byDay.values()];
}

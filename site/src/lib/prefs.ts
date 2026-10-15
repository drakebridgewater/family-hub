/**
 * Per-user home page preferences, keyed by Authelia username so they follow
 * the person across devices. Stored in Postgres (see db.ts); in memory without it.
 */
import { ensureTable, pool } from "./db";

export type HomeTab = "feed" | "schedule" | "apps";
/** auto = icons in narrow spaces (phone, desktop sidebar), list with descriptions when wide. */
export type AppView = "auto" | "compact" | "detailed";
/** Phone-app store buttons on app tiles: auto = whichever matches the device's OS, none on computers. */
export type MobileApps = "off" | "auto" | "android" | "ios";

export interface Prefs {
	/** Apps the user chose to hide (app ids; older entries are URLs). */
	hidden: string[];
	/** Favorite apps (ids), shown first in this order. */
	pinned: string[];
	/** Calendar days to show, starting today. */
	days: number;
	/** Which tab the home page opens to on phones. */
	startTab: HomeTab;
	/** How the app launcher is drawn. */
	appView: AppView;
	/** Which phone-app store buttons to show. */
	mobileApps: MobileApps;
}

export const DAY_CHOICES = [1, 3, 7, 14, 30] as const;
export const TABS: HomeTab[] = ["feed", "schedule", "apps"];
export const APP_VIEWS: AppView[] = ["auto", "compact", "detailed"];
export const MOBILE_APPS: MobileApps[] = ["off", "auto", "android", "ios"];
export const DEFAULT_PREFS: Prefs = {
	hidden: [],
	pinned: [],
	days: 7,
	startTab: "feed",
	appView: "auto",
	mobileApps: "auto",
};

export function normalizePrefs(raw: unknown): Prefs {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const days = Number(r.days);
	const strings = (v: unknown) =>
		Array.isArray(v) ? [...new Set(v.filter((u): u is string => typeof u === "string"))].slice(0, 200) : [];
	return {
		hidden: strings(r.hidden),
		pinned: strings(r.pinned),
		days: (DAY_CHOICES as readonly number[]).includes(days) ? days : DEFAULT_PREFS.days,
		startTab: TABS.includes(r.startTab as HomeTab) ? (r.startTab as HomeTab) : DEFAULT_PREFS.startTab,
		appView: APP_VIEWS.includes(r.appView as AppView) ? (r.appView as AppView) : DEFAULT_PREFS.appView,
		mobileApps: MOBILE_APPS.includes(r.mobileApps as MobileApps)
			? (r.mobileApps as MobileApps)
			: DEFAULT_PREFS.mobileApps,
	};
}

const memory = new Map<string, Prefs>();

const ensurePrefsTable = () =>
	ensureTable(
		"family_hub_prefs",
		`CREATE TABLE IF NOT EXISTS family_hub_prefs (
			username   text PRIMARY KEY,
			prefs      jsonb NOT NULL DEFAULT '{}',
			updated_at timestamptz NOT NULL DEFAULT now()
		)`,
	);

export async function getPrefs(username: string): Promise<Prefs> {
	if (!pool) return memory.get(username) ?? DEFAULT_PREFS;
	try {
		await ensurePrefsTable();
		const { rows } = await pool.query("SELECT prefs FROM family_hub_prefs WHERE username = $1", [username]);
		return normalizePrefs(rows[0]?.prefs);
	} catch (err) {
		console.warn("[family-hub] Could not load preferences:", (err as Error).message);
		return DEFAULT_PREFS;
	}
}

export async function savePrefs(username: string, prefs: Prefs): Promise<void> {
	const clean = normalizePrefs(prefs);
	if (!pool) {
		memory.set(username, clean);
		return;
	}
	await ensurePrefsTable();
	await pool.query(
		`INSERT INTO family_hub_prefs (username, prefs, updated_at) VALUES ($1, $2, now())
		 ON CONFLICT (username) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
		[username, JSON.stringify(clean)],
	);
}

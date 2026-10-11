/**
 * Per-user home page preferences, keyed by Authelia username so they follow
 * the person across devices. Stored in the same Postgres database as EmDash
 * (connection from the PG* env vars), in a table EmDash doesn't touch.
 * Without Postgres (EMDASH_DB=sqlite dev mode) they live in memory.
 */
import pg from "pg";

export type HomeTab = "feed" | "schedule" | "apps";
/** auto = icons in narrow spaces (phone, desktop sidebar), list with descriptions when wide. */
export type AppView = "auto" | "compact" | "detailed";

export interface Prefs {
	/** URLs of services the user chose to hide. */
	hidden: string[];
	/** Calendar days to show, starting today. */
	days: number;
	/** Which tab the home page opens to on phones. */
	startTab: HomeTab;
	/** How the app launcher is drawn. */
	appView: AppView;
}

export const DAY_CHOICES = [1, 3, 7, 14, 30] as const;
export const TABS: HomeTab[] = ["feed", "schedule", "apps"];
export const APP_VIEWS: AppView[] = ["auto", "compact", "detailed"];
export const DEFAULT_PREFS: Prefs = { hidden: [], days: 7, startTab: "feed", appView: "auto" };

export function normalizePrefs(raw: unknown): Prefs {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const days = Number(r.days);
	return {
		hidden: Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((u): u is string => typeof u === "string"))].slice(0, 200) : [],
		days: (DAY_CHOICES as readonly number[]).includes(days) ? days : DEFAULT_PREFS.days,
		startTab: TABS.includes(r.startTab as HomeTab) ? (r.startTab as HomeTab) : DEFAULT_PREFS.startTab,
		appView: APP_VIEWS.includes(r.appView as AppView) ? (r.appView as AppView) : DEFAULT_PREFS.appView,
	};
}

const pool = process.env.PGHOST ? new pg.Pool({ max: 3 }) : null;
const memory = new Map<string, Prefs>();
let ready: Promise<unknown> | null = null;

function ensureTable() {
	ready ??= pool!
		.query(
			`CREATE TABLE IF NOT EXISTS family_hub_prefs (
				username   text PRIMARY KEY,
				prefs      jsonb NOT NULL DEFAULT '{}',
				updated_at timestamptz NOT NULL DEFAULT now()
			)`,
		)
		.catch((err) => {
			ready = null; // retry on the next request
			throw err;
		});
	return ready;
}

export async function getPrefs(username: string): Promise<Prefs> {
	if (!pool) return memory.get(username) ?? DEFAULT_PREFS;
	try {
		await ensureTable();
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
	await ensureTable();
	await pool.query(
		`INSERT INTO family_hub_prefs (username, prefs, updated_at) VALUES ($1, $2, now())
		 ON CONFLICT (username) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()`,
		[username, JSON.stringify(clean)],
	);
}

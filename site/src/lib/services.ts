/**
 * The app launcher's catalog: sections of services (tiles).
 *
 * Admins (ADMIN_GROUPS, default "admin") edit it at /admin/apps, which stores
 * it in Postgres. Until the first save there, it's read from
 * config/services.yaml (a volume on Unraid), re-read whenever that file changes.
 *
 * Each app has a policy:
 *   optional - shown to its groups; each person can hide it on /settings (default)
 *   always   - shown to its groups and can't be hidden
 *   hidden   - hidden from everyone, but kept in the list for later
 *
 * NOTE: hiding a tile is a convenience, not security. Each service must still
 * be protected by its own Authelia access_control rule.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { FamilyUser } from "./auth";
import { ensureTable, pool } from "./db";
import { getPrefs, type Prefs } from "./prefs";

export type AppPolicy = "optional" | "always" | "hidden";
export const APP_POLICIES: AppPolicy[] = ["optional", "always", "hidden"];

export interface Service {
	id: string;
	name: string;
	url: string;
	icon?: string;
	description?: string;
	/** Authelia groups that may see this tile. Omit/empty = every signed-in user. */
	groups?: string[];
	policy: AppPolicy;
}

export interface ServiceSection {
	id: string;
	title: string;
	services: Service[];
}

export interface Catalog {
	sections: ServiceSection[];
	/** Where the list currently comes from; "file" until an admin first saves. */
	source: "database" | "file";
}

const CONFIG_FILE = path.join(process.env.CONFIG_DIR ?? "./config", "services.yaml");
export const ADMIN_GROUPS = (process.env.ADMIN_GROUPS ?? "admin")
	.split(",")
	.map((g) => g.trim())
	.filter(Boolean);

export function isAppAdmin(user: FamilyUser | null | undefined): boolean {
	return !!user && user.groups.some((g) => ADMIN_GROUPS.includes(g));
}

export const newId = () => randomUUID().replace(/-/g, "").slice(0, 10);
const stableId = (seed: string) => createHash("sha1").update(seed).digest("hex").slice(0, 10);

// ---------------------------------------------------------------- validation

/** http(s) URLs and same-site paths only, so a tile can never be a javascript: link. */
export function safeUrl(raw: unknown): string | null {
	const url = String(raw ?? "").trim();
	if (url.startsWith("/") && !url.startsWith("//")) return url;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
	} catch {
		return null;
	}
}

export function parseGroups(raw: unknown): string[] {
	const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\s,]+/);
	return [...new Set(list.map((g) => String(g).trim()).filter((g) => /^[\w.@-]+$/.test(g)))];
}

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** Cleans one service from YAML, the database or an admin form. Null if unusable. */
export function normalizeService(raw: any, fallbackId: string): Service | null {
	const name = clip(raw?.name, 60);
	const url = safeUrl(raw?.url);
	if (!name || !url) return null;
	const icon = clip(raw.icon, 300);
	const description = clip(raw.description, 120);
	const groups = parseGroups(raw.groups);
	return {
		id: clip(raw.id, 40) || fallbackId,
		name,
		url,
		...(icon && { icon }),
		...(description && { description }),
		...(groups.length && { groups }),
		policy: APP_POLICIES.includes(raw.policy) ? raw.policy : "optional",
	};
}

function normalizeSections(raw: any): ServiceSection[] {
	return (Array.isArray(raw) ? raw : []).map((s: any, i: number) => {
		const title = clip(s?.title, 60);
		return {
			id: clip(s?.id, 40) || stableId(`section:${i}:${title}`),
			title,
			services: (Array.isArray(s?.services) ? s.services : [])
				.map((svc: any) => normalizeService(svc, stableId(`app:${svc?.url}`)))
				.filter((svc: Service | null): svc is Service => !!svc),
		};
	});
}

// ------------------------------------------------------------------- storage

let fileCache: { mtimeMs: number; sections: ServiceSection[] } | null = null;

async function loadFile(): Promise<ServiceSection[]> {
	try {
		const { mtimeMs } = await stat(CONFIG_FILE);
		if (fileCache?.mtimeMs === mtimeMs) return fileCache.sections;
		const doc = parse(await readFile(CONFIG_FILE, "utf8")) ?? {};
		fileCache = { mtimeMs, sections: normalizeSections(doc.sections) };
		return fileCache.sections;
	} catch (err) {
		console.warn(`[family-hub] Could not read ${CONFIG_FILE}:`, (err as Error).message);
		return fileCache?.sections ?? [];
	}
}

const ensureConfigTable = () =>
	ensureTable(
		"family_hub_config",
		`CREATE TABLE IF NOT EXISTS family_hub_config (
			key        text PRIMARY KEY,
			value      jsonb NOT NULL,
			updated_by text,
			updated_at timestamptz NOT NULL DEFAULT now()
		)`,
	);

// One container serves the site, so a short cache plus clearing it on save is enough.
const DB_CACHE_MS = 30_000;
let dbCache: { at: number; sections: ServiceSection[] | null } | null = null;
let memory: ServiceSection[] | null = null;

async function loadStored(): Promise<ServiceSection[] | null> {
	if (!pool) return memory;
	if (dbCache && Date.now() - dbCache.at < DB_CACHE_MS) return dbCache.sections;
	try {
		await ensureConfigTable();
		const { rows } = await pool.query("SELECT value FROM family_hub_config WHERE key = 'apps'");
		const sections = rows[0] ? normalizeSections(rows[0].value?.sections) : null;
		dbCache = { at: Date.now(), sections };
		return sections;
	} catch (err) {
		console.warn("[family-hub] Could not load apps from the database:", (err as Error).message);
		return dbCache?.sections ?? null;
	}
}

export async function getCatalog(): Promise<Catalog> {
	const stored = await loadStored();
	return stored ? { sections: stored, source: "database" } : { sections: await loadFile(), source: "file" };
}

export async function saveCatalog(sections: ServiceSection[], username: string): Promise<void> {
	const clean = normalizeSections(sections);
	if (!pool) {
		memory = clean;
		return;
	}
	await ensureConfigTable();
	await pool.query(
		`INSERT INTO family_hub_config (key, value, updated_by, updated_at) VALUES ('apps', $1, $2, now())
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		[JSON.stringify({ sections: clean }), username],
	);
	dbCache = { at: Date.now(), sections: clean };
}

// ------------------------------------------------------------------- viewing

/** Everything this person may see: their groups, minus apps an admin hid. */
export async function servicesFor(user: FamilyUser): Promise<ServiceSection[]> {
	const userGroups = new Set(user.groups);
	return (await getCatalog()).sections
		.map((section) => ({
			...section,
			services: section.services.filter(
				(svc) => svc.policy !== "hidden" && (!svc.groups?.length || svc.groups.some((g) => userGroups.has(g))),
			),
		}))
		.filter((section) => section.services.length > 0);
}

/** Older preferences stored URLs instead of ids. */
export const prefMatches = (list: Set<string>, svc: Service) => list.has(svc.id) || list.has(svc.url);

export interface Launcher {
	/** Sections after the person's own hiding. */
	sections: ServiceSection[];
	/** Their starred apps, in the order they starred them. */
	favorites: Service[];
	hiddenCount: number;
}

export function arrange(sections: ServiceSection[], prefs: Pick<Prefs, "hidden" | "pinned">): Launcher {
	const hidden = new Set(prefs.hidden);
	const visible = sections
		.map((section) => ({
			...section,
			services: section.services.filter((svc) => svc.policy === "always" || !prefMatches(hidden, svc)),
		}))
		.filter((section) => section.services.length > 0);
	const all = visible.flatMap((s) => s.services);
	const favorites = prefs.pinned
		.map((id) => all.find((svc) => svc.id === id || svc.url === id))
		.filter((svc, i, list): svc is Service => !!svc && list.indexOf(svc) === i);
	const count = (list: ServiceSection[]) => list.reduce((n, s) => n + s.services.length, 0);
	return { sections: visible, favorites, hiddenCount: count(sections) - count(visible) };
}

export async function launcherFor(user: FamilyUser, prefs?: Prefs): Promise<Launcher> {
	const [sections, p] = await Promise.all([servicesFor(user), prefs ?? getPrefs(user.username)]);
	return arrange(sections, p);
}

/**
 * Icon shorthand, matching Homepage conventions:
 *   "plex"            -> dashboard-icons CDN (png)
 *   "https://..."     -> used as-is
 *   "🎬" (anything else short) -> rendered as an emoji/text glyph
 *   ""                -> "letter": the caller draws a letter tile from the app's name
 */
export function resolveIcon(icon?: string): { kind: "img" | "glyph" | "letter"; value: string } {
	if (!icon) return { kind: "letter", value: "" };
	if (/^https?:\/\//.test(icon) || icon.startsWith("/")) return { kind: "img", value: icon };
	if (/^[a-z0-9-]+$/.test(icon)) {
		return {
			kind: "img",
			value: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${icon}.png`,
		};
	}
	return { kind: "glyph", value: icon };
}

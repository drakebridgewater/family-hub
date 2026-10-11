/**
 * Service launcher config, read from config/services.yaml (a volume on Unraid).
 * The file is re-read when its mtime changes, so edits apply without a restart.
 *
 * NOTE: hiding a tile is a convenience, not security. Each service must still
 * be protected by its own Authelia access_control rule.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import type { FamilyUser } from "./auth";

export interface Service {
	name: string;
	url: string;
	icon?: string;
	description?: string;
	/** Authelia groups that may see this tile. Omit/empty = every signed-in user. */
	groups?: string[];
}

export interface ServiceSection {
	title: string;
	services: Service[];
}

const CONFIG_FILE = path.join(process.env.CONFIG_DIR ?? "./config", "services.yaml");

let cache: { mtimeMs: number; sections: ServiceSection[] } | null = null;

async function loadSections(): Promise<ServiceSection[]> {
	try {
		const { mtimeMs } = await stat(CONFIG_FILE);
		if (cache?.mtimeMs === mtimeMs) return cache.sections;

		const doc = parse(await readFile(CONFIG_FILE, "utf8")) ?? {};
		const sections: ServiceSection[] = (doc.sections ?? []).map((s: any) => ({
			title: String(s.title ?? ""),
			services: (s.services ?? []).filter((svc: any) => svc?.name && svc?.url),
		}));
		cache = { mtimeMs, sections };
		return sections;
	} catch (err) {
		console.warn(`[family-hub] Could not read ${CONFIG_FILE}:`, (err as Error).message);
		return cache?.sections ?? [];
	}
}

export async function servicesFor(user: FamilyUser): Promise<ServiceSection[]> {
	const userGroups = new Set(user.groups);
	return (await loadSections())
		.map((section) => ({
			...section,
			services: section.services.filter(
				(svc) => !svc.groups?.length || svc.groups.some((g) => userGroups.has(g)),
			),
		}))
		.filter((section) => section.services.length > 0);
}

/**
 * Icon shorthand, matching Homepage conventions:
 *   "plex"            -> dashboard-icons CDN (png)
 *   "https://..."     -> used as-is
 *   "🎬" (anything else short) -> rendered as an emoji/text glyph
 */
export function resolveIcon(icon?: string): { kind: "img" | "glyph"; value: string } {
	if (!icon) return { kind: "glyph", value: "🔗" };
	if (/^https?:\/\//.test(icon) || icon.startsWith("/")) return { kind: "img", value: icon };
	if (/^[a-z0-9-]+$/.test(icon)) {
		return {
			kind: "img",
			value: `https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/${icon}.png`,
		};
	}
	return { kind: "glyph", value: icon };
}

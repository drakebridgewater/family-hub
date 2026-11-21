/**
 * "Watch on your TV": the hub approves a Jellyfin Quick Connect code for the
 * signed-in person, so a new TV signs in without typing a password on a remote.
 *
 * The hub calls Jellyfin with an API key (admin-level), finds the Jellyfin user
 * whose name matches the Authelia username (ignoring case), and authorizes the
 * code the TV shows for that user only. Jellyfin 10.9+.
 */
import type { Service } from "./services";

const env = (key: string, fallback = "") => process.env[key] || fallback;

const INTERNAL_URL = env("JELLYFIN_INTERNAL_URL", "http://jellyfin:8096").replace(/\/+$/, "");
const API_KEY = env("JELLYFIN_API_KEY");
/** The address people type into the TV app. */
export const JELLYFIN_PUBLIC_URL = env("JELLYFIN_PUBLIC_URL").replace(/\/+$/, "");

const publicHost = (() => {
	try {
		return JELLYFIN_PUBLIC_URL ? new URL(JELLYFIN_PUBLIC_URL).host : "";
	} catch {
		return "";
	}
})();

/** The page, the account-menu link and the Streaming tile's link only exist once Jellyfin is configured. */
export const tvEnabled = () => !!API_KEY && !!publicHost;

/** The Streaming tile: the app whose URL is on the same host as JELLYFIN_PUBLIC_URL. */
export function isJellyfinApp(svc: Pick<Service, "url">): boolean {
	if (!publicHost) return false;
	try {
		return new URL(svc.url).host === publicHost;
	} catch {
		return false;
	}
}

// --------------------------------------------------------------- API calls

class Unavailable extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
	try {
		return await fetch(`${INTERNAL_URL}${path}`, {
			...init,
			signal: AbortSignal.timeout(2500),
			headers: {
				// The only form Jellyfin 10.11 accepts by default (X-Emby-Token / ?api_key are off).
				Authorization: `MediaBrowser Token="${API_KEY}"`,
				Accept: "application/json",
				...init.headers,
			},
		});
	} catch (err) {
		console.warn("[family-hub] Jellyfin request failed:", (err as Error).message);
		throw new Unavailable();
	}
}

export interface JellyfinUser {
	id: string;
	name: string;
}

const USERS_CACHE_MS = 60_000;
let usersCache: { at: number; users: Array<JellyfinUser & { disabled: boolean }> } | null = null;

async function listUsers() {
	if (usersCache && Date.now() - usersCache.at < USERS_CACHE_MS) return usersCache.users;
	const res = await call("/Users");
	if (!res.ok) {
		console.warn(`[family-hub] Jellyfin /Users answered ${res.status}`);
		throw new Unavailable();
	}
	const raw = (await res.json()) as Array<{ Id?: string; Name?: string; Policy?: { IsDisabled?: boolean } }>;
	const users = (Array.isArray(raw) ? raw : [])
		.filter((u) => u.Id && u.Name)
		.map((u) => ({ id: u.Id!, name: u.Name!, disabled: !!u.Policy?.IsDisabled }));
	usersCache = { at: Date.now(), users };
	return users;
}

/** The person's Jellyfin account (same name as their hub username, any case), or null. Throws if Jellyfin is down. */
export async function findJellyfinUser(username: string): Promise<JellyfinUser | null> {
	const wanted = username.toLowerCase();
	const match = (await listUsers()).find((u) => u.name.toLowerCase() === wanted && !u.disabled);
	return match ? { id: match.id, name: match.name } : null;
}

export type AccountState = { state: "ok"; user: JellyfinUser } | { state: "no-account" } | { state: "unavailable" };

/** For rendering the page: does this person have a Jellyfin account we can sign a TV into? */
export async function jellyfinAccount(username: string): Promise<AccountState> {
	try {
		const user = await findJellyfinUser(username);
		return user ? { state: "ok", user } : { state: "no-account" };
	} catch {
		return { state: "unavailable" };
	}
}

// ------------------------------------------------------------ Quick Connect

export type ConnectResult =
	| { ok: true; user: JellyfinUser }
	| { ok: false; reason: "invalid" | "bad-code" | "no-account" | "disabled" | "rate-limited" | "unavailable" };

/** 6-digit codes expire in minutes, but nobody should get to guess: 8 tries per person per 10 minutes. */
const MAX_TRIES = 8;
const WINDOW_MS = 10 * 60_000;
const tries = new Map<string, number[]>();

function rateLimited(username: string): boolean {
	const now = Date.now();
	const recent = (tries.get(username) ?? []).filter((t) => now - t < WINDOW_MS);
	if (recent.length >= MAX_TRIES) {
		tries.set(username, recent);
		return true;
	}
	recent.push(now);
	tries.set(username, recent);
	return false;
}

/** Strips spaces and dashes; null unless what's left is exactly six digits. */
export function cleanCode(raw: unknown): string | null {
	const code = String(raw ?? "").replace(/[\s-]/g, "");
	return /^\d{6}$/.test(code) ? code : null;
}

/** Approves the code a TV shows, for the signed-in person's own Jellyfin account. */
export async function authorizeCode(username: string, rawCode: unknown): Promise<ConnectResult> {
	const code = cleanCode(rawCode);
	if (!code) return { ok: false, reason: "invalid" };
	if (rateLimited(username)) return { ok: false, reason: "rate-limited" };

	try {
		const user = await findJellyfinUser(username);
		if (!user) return { ok: false, reason: "no-account" };

		const params = new URLSearchParams({ code, userId: user.id });
		const res = await call(`/QuickConnect/Authorize?${params}`, { method: "POST" });
		if (res.ok) {
			const body = await res.text();
			return body.trim() === "false" ? { ok: false, reason: "bad-code" } : { ok: true, user };
		}
		// 404: unknown or expired code. 401/403: Quick Connect is off, or the key is wrong.
		if (res.status === 404 || res.status === 400) return { ok: false, reason: "bad-code" };
		if (res.status === 401 || res.status === 403) {
			console.warn(`[family-hub] Jellyfin refused Quick Connect (${res.status}): is it enabled, and is the API key valid?`);
			return { ok: false, reason: "disabled" };
		}
		console.warn(`[family-hub] Jellyfin Quick Connect answered ${res.status}`);
		return { ok: false, reason: "unavailable" };
	} catch {
		return { ok: false, reason: "unavailable" };
	}
}

// ---------------------------------------------------------------- the apps

/** Only list apps with a Quick Connect sign-in: the whole page is built around it. */
export interface TvApp {
	name: string;
	note?: string;
}

export interface TvPlatform {
	id: string;
	/** What the TV is called. */
	platform: string;
	/** The app store on that TV, phrased for someone holding a remote. */
	store: string;
	/** The first app is the one we suggest; the rest are good alternatives. */
	apps: TvApp[];
}

/** The TV apps the page recommends. Edit freely; the page renders whatever is here. */
export const TV_PLATFORMS: TvPlatform[] = [
	{
		id: "apple-tv",
		platform: "Apple TV",
		store: "the App Store",
		apps: [
			{ name: "Swiftfin", note: "Jellyfin's own app" },
			{ name: "Moonfin" },
		],
	},
	{
		id: "android-tv",
		platform: "Android TV / Google TV",
		store: "Google Play (Fire TV: the Amazon Appstore)",
		apps: [
			{ name: "Jellyfin for Android TV", note: "Jellyfin's own app" },
			{ name: "Moonfin" },
		],
	},
	{
		id: "roku",
		platform: "Roku",
		store: "the Roku Channel Store",
		apps: [{ name: "Jellyfin", note: "Jellyfin's own app" }],
	},
	{
		id: "samsung",
		platform: "Samsung",
		store: "Apps on the Smart Hub",
		apps: [
			{ name: "Jellyfin", note: "Jellyfin's own app, 2021 or newer TVs" },
			{ name: "Moonfin", note: "also for older TVs" },
		],
	},
];

export const OTHER_CLIENTS_URL = "https://jellyfin.org/downloads/clients";

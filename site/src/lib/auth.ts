/**
 * "Soft" Authelia session detection.
 *
 * The public site is NOT behind Traefik's forwardAuth (anonymous visitors must
 * see the feed), so Remote-* headers never arrive here and must never be
 * trusted from the client. Instead we ask Authelia directly: we forward the
 * visitor's cookies to Authelia's forward-auth endpoint as if they were
 * requesting /login on this site. A 200 means "logged in" and comes back with
 * Remote-User / Remote-Groups / Remote-Name / Remote-Email. Anything else
 * (302/401/timeout) means anonymous.
 */

export interface FamilyUser {
	username: string;
	name: string;
	email: string;
	groups: string[];
}

const env = (key: string, fallback = "") => process.env[key] ?? fallback;

const AUTHELIA_INTERNAL_URL = env("AUTHELIA_INTERNAL_URL", "http://authelia:9091");
// Authelia >= 4.38. For older releases use "/api/verify".
const AUTHELIA_AUTHZ_PATH = env("AUTHELIA_AUTHZ_PATH", "/api/authz/forward-auth");
const AUTHELIA_SESSION_COOKIE = env("AUTHELIA_SESSION_COOKIE", "authelia_session");
const SITE_URL = new URL(env("EMDASH_SITE_URL", "https://social.bridgewater.digital"));

export async function getFamilyUser(request: Request): Promise<FamilyUser | null> {
	const cookie = request.headers.get("cookie");
	if (!cookie || !cookie.includes(`${AUTHELIA_SESSION_COOKIE}=`)) return null;

	try {
		const res = await fetch(`${AUTHELIA_INTERNAL_URL}${AUTHELIA_AUTHZ_PATH}`, {
			method: "GET",
			redirect: "manual",
			signal: AbortSignal.timeout(2500),
			headers: {
				Cookie: cookie,
				Accept: "application/json",
				"X-Forwarded-Method": "GET",
				"X-Forwarded-Proto": SITE_URL.protocol.replace(":", ""),
				"X-Forwarded-Host": SITE_URL.host,
				"X-Forwarded-Uri": "/login",
				"X-Forwarded-For":
					request.headers.get("x-real-ip") ??
					request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
					"127.0.0.1",
			},
		});
		if (res.status !== 200) return null;

		const username = res.headers.get("remote-user");
		if (!username) return null;

		return {
			username,
			name: res.headers.get("remote-name") || username,
			email: res.headers.get("remote-email") || "",
			groups: (res.headers.get("remote-groups") || "")
				.split(",")
				.map((g) => g.trim())
				.filter(Boolean),
		};
	} catch (err) {
		console.warn("[family-hub] Authelia check failed:", (err as Error).message);
		return null;
	}
}

export function logoutUrl(): string {
	const authUrl = env("AUTHELIA_PUBLIC_URL", "https://auth.bridgewater.digital");
	return `${authUrl}/logout?rd=${encodeURIComponent(SITE_URL.origin + "/")}`;
}

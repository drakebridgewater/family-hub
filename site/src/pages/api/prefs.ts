import type { APIRoute } from "astro";
import { getFamilyUser } from "../../lib/auth";
import { getPrefs, savePrefs } from "../../lib/prefs";

/**
 * Quick preference changes from the home page (e.g. the compact/detailed
 * apps switch) without a trip to /settings. Body: a partial Prefs as JSON.
 */
export const POST: APIRoute = async ({ request, url }) => {
	const siteOrigin = new URL(process.env.EMDASH_SITE_URL ?? url.origin).origin;
	if (request.headers.get("origin") !== siteOrigin) return new Response("Forbidden", { status: 403 });

	const user = await getFamilyUser(request);
	if (!user) return new Response("Sign in first", { status: 401 });

	let patch: Record<string, unknown>;
	try {
		patch = await request.json();
	} catch {
		return new Response("Expected JSON", { status: 400 });
	}
	const current = await getPrefs(user.username);
	// Only the simple settings; the hidden-apps list is edited on /settings.
	const { appView, days, startTab, mobileApps } = patch;
	await savePrefs(user.username, {
		...current,
		...(appView !== undefined && { appView }),
		...(days !== undefined && { days }),
		...(startTab !== undefined && { startTab }),
		...(mobileApps !== undefined && { mobileApps }),
	} as typeof current);
	return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
};

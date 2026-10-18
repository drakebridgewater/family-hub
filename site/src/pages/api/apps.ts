import type { APIRoute } from "astro";
import { getFamilyUser } from "../../lib/auth";
import { launcherFor, resolveIcon, type Service } from "../../lib/services";

/**
 * The signed-in person's apps, for the apps launcher in every bridgewater.digital
 * app's header (the style guide's Header fetches this with credentials). Same
 * list, favorites and order as the hub's own launcher; 401 when signed out.
 *
 * Other apps call it cross-origin, so credentialed CORS is allowed for https
 * sites on this hub's parent domain (social.bridgewater.digital ->
 * *.bridgewater.digital). The Authelia cookie must be scoped to that domain.
 */
const site = new URL(process.env.EMDASH_SITE_URL ?? "https://social.example.com");
const parent = site.hostname.split(".").slice(1).join(".");

function corsHeaders(origin: string | null): Record<string, string> {
	if (!origin) return {};
	let host: string;
	try {
		const url = new URL(origin);
		if (url.protocol !== "https:" && url.origin !== site.origin) return {};
		host = url.hostname;
	} catch {
		return {};
	}
	if (host !== site.hostname && !(parent.includes(".") && host.endsWith(`.${parent}`))) return {};
	return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" };
}

const toApp = (svc: Service) => {
	const icon = resolveIcon(svc.icon);
	return {
		name: svc.name,
		// Paths on the hub ("/photos") would resolve against the calling app, so make them absolute.
		url: new URL(svc.url, site).href,
		description: svc.description ?? "",
		icon: icon.kind === "img" ? new URL(icon.value, site).href : null,
		glyph: icon.kind === "glyph" ? icon.value : null,
	};
};

export const GET: APIRoute = async ({ request }) => {
	const headers = {
		"Content-Type": "application/json",
		"Cache-Control": "private, no-store",
		Vary: "Origin, Cookie",
		...corsHeaders(request.headers.get("origin")),
	};
	const user = await getFamilyUser(request);
	if (!user) return new Response(JSON.stringify({ error: "Sign in first" }), { status: 401, headers });

	const launcher = await launcherFor(user);
	const body = {
		favorites: launcher.favorites.map(toApp),
		sections: launcher.sections.map((s) => ({ title: s.title, apps: s.services.map(toApp) })),
	};
	return new Response(JSON.stringify(body), { headers });
};

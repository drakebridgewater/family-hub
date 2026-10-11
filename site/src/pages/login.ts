import type { APIRoute } from "astro";

/**
 * Traefik routes /login through the Authelia forwardAuth middleware, so a
 * request only reaches this handler once the visitor has a valid session.
 * Send them back where they came from (?next=, same-site paths only) or home.
 */
export const GET: APIRoute = ({ redirect, url }) => {
	const next = url.searchParams.get("next") ?? "";
	const safe = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
	return redirect(safe ? next : "/", 302);
};

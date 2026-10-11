import type { APIRoute } from "astro";

/**
 * Traefik routes /login through the Authelia forwardAuth middleware, so a
 * request only reaches this handler once the visitor has a valid session.
 * We just send them back to the home page, which then detects the session.
 */
export const GET: APIRoute = ({ redirect }) => redirect("/", 302);

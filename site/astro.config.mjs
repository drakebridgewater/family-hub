import node from "@astrojs/node";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";
import { defineConfig, sessionDrivers } from "astro/config";
import emdash, { local } from "emdash/astro";
import { postgres, sqlite } from "emdash/db";
import { EDITOR_ROLE_GROUPS } from "./src/lib/editor-roles.ts";

// Paths are relative to the container's WORKDIR (/app); data and uploads are volumes.
//
// EmDash serializes the database config into the build, so nothing secret goes
// here. Postgres connection details come from the container's PG* variables
// (the pool) and DATABASE_URL (migrations) at runtime; see docker-compose.yml.
// Set EMDASH_DB=sqlite for local `npm run dev` without a Postgres server.
const database =
	process.env.EMDASH_DB === "sqlite"
		? sqlite({ url: "file:./data/emdash.db" })
		: postgres({});

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	// The adapter's default session store is node_modules/.astro/sessions, which
	// the container user (99:100) can't write. Keep sessions on the data volume.
	session: { driver: sessionDrivers.fsLite({ base: "./data/sessions" }) },
	image: { layout: "constrained", responsiveStyles: true },
	integrations: [
		react(),
		emdash({
			database,
			// Editor sign-in comes from Authelia (site/src/lib/emdash-auth.ts);
			// this turns off EmDash's own passkey login. Group -> role levels are
			// in site/src/lib/editor-roles.ts and re-sync from lldap each visit.
			auth: {
				type: "authelia",
				entrypoint: fileURLToPath(new URL("./src/lib/emdash-auth.ts", import.meta.url)),
				config: {
					roleGroups: EDITOR_ROLE_GROUPS,
					autoProvision: true,
					syncRoles: true,
				},
			},
			storage: local({
				directory: "./uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
		}),
	],
	devToolbar: { enabled: false },
});

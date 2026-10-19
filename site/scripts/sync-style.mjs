#!/usr/bin/env node
/**
 * Copy the bridgewater.digital style (github.com/drakebridgewater/style.bridgewater)
 * into this site. The copies are committed, so the Docker build never fetches it:
 * the style repo is private, and the build image has no git or credentials.
 *
 *   node scripts/sync-style.mjs [path/to/style.bridgewater]
 *
 * The path defaults to $STYLE_DIR, then a sibling checkout of this repo
 * (../../style.bridgewater or ../../bridgewater-brand). Check out a release tag
 * there first, re-run this, then commit the result.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIG = "green"; // this site's signature hue; keep in step with data-sig in Base.astro
const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [process.argv[2], process.env.STYLE_DIR, join(site, "../../style.bridgewater"), join(site, "../../bridgewater-brand")];
const src = candidates.filter(Boolean).map((p) => resolve(p)).find((p) => existsSync(join(p, "tokens.json")));
if (!src) {
	console.error("No style.bridgewater checkout found. Pass its path as the first argument.");
	process.exit(1);
}

const styles = join(site, "src/styles/bridgewater");
const pub = join(site, "public");
rmSync(styles, { recursive: true, force: true });
mkdirSync(styles, { recursive: true });

// The one stylesheet (tokens + components) with its self-hosted fonts beside it, and the
// tokens themselves, so the head can read the page colors instead of copying hex values.
copyFileSync(join(src, "components/bridgewater.css"), join(styles, "bridgewater.css"));
cpSync(join(src, "components/fonts"), join(styles, "fonts"), { recursive: true });
copyFileSync(join(src, "tokens.json"), join(styles, "tokens.json"));

// The mark, logotype, icon and skyline geometry, so the Astro components render the same SVGs server-side.
const bundleJs = readFileSync(join(src, "components/bundle.js"), "utf8");
const shapes = /^\s*var D = (\{.*\});$/m.exec(bundleJs)?.[1];
if (!shapes) throw new Error("Couldn't find the shape data (var D = {...}) in components/bundle.js");
writeFileSync(join(styles, "shapes.json"), JSON.stringify(JSON.parse(shapes)) + "\n");

// Favicons and app icons. The style ships a pre-rendered set per signature hue, so copy
// SIG's folder across as it is. Each entry is the name to write into public/, and the name
// the same icon has in the teal set at the top of assets/Favicons, which is what we fall
// back to if the style ever ships no folder for SIG.
const fav = join(src, "assets/Favicons");
const hue = join(fav, SIG);
if (!existsSync(hue)) console.warn(`The style ships no ${SIG} icons (${hue}); copying its teal ones.`);
const icons = [
	["favicon.svg", `favicon-${SIG}.svg`],
	["favicon-32.png"],
	["apple-touch-icon.png"],
	["icon-192.png"],
	["icon-512.png"],
	["icon-maskable-512.png"],
	["og-image.png"],
];
for (const [name, teal = name] of icons) {
	const file = join(hue, name);
	copyFileSync(existsSync(file) ? file : join(fav, teal), join(pub, name));
}
const manifest = JSON.parse(readFileSync(join(fav, "site.webmanifest.json"), "utf8"));
writeFileSync(join(pub, "site.webmanifest"), JSON.stringify({ ...manifest, name: "Family hub", short_name: "Family", start_url: "/" }, null, 2) + "\n");

let rev = "unknown";
try {
	rev = execFileSync("git", ["-C", src, "describe", "--tags", "--always"], { encoding: "utf8" }).trim();
} catch {}
const version = JSON.parse(readFileSync(join(src, "package.json"), "utf8")).version;
writeFileSync(
	join(styles, "VERSION"),
	`style.bridgewater ${version} (${rev})\nCopied by scripts/sync-style.mjs; edit the style repo, not these files.\n`,
);
console.log(`Synced style.bridgewater ${version} (${rev}) from ${src}`);

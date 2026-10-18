#!/usr/bin/env node
/**
 * Copy the bridgewater.digital style (github.com/drakebridgewater/style.bridgewater)
 * into this site. The copies are committed, so the Docker build never fetches it.
 *
 *   node scripts/sync-style.mjs [path/to/style.bridgewater]
 *
 * The path defaults to $STYLE_DIR, then ../../style.bridgewater (a sibling of
 * this repo). Re-run it after changing the style repo, then commit the result.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIG = "green"; // this site's signature hue; keep in step with data-sig in Base.astro
const site = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] ?? process.env.STYLE_DIR ?? join(site, "../../style.bridgewater"));
if (!existsSync(join(src, "tokens.css"))) {
	console.error(`No style.bridgewater checkout at ${src}. Pass its path as the first argument.`);
	process.exit(1);
}

const styles = join(site, "src/styles/bridgewater");
const pub = join(site, "public");
mkdirSync(styles, { recursive: true });

// Stylesheets. Fonts are self-hosted (@fontsource in Base.astro), so drop the Google Fonts import.
copyFileSync(join(src, "tokens.css"), join(styles, "tokens.css"));
const bundleCss = readFileSync(join(src, "components/bundle.css"), "utf8").replace(/^@import url\("https:\/\/fonts\.googleapis\.com[^\n]*\n+/m, "");
writeFileSync(join(styles, "bundle.css"), bundleCss);

// The mark, logotype, icon and skyline geometry, so the Astro components render the same SVGs server-side.
const bundleJs = readFileSync(join(src, "components/bundle.js"), "utf8");
const shapes = /^\s*var D = (\{.*\});$/m.exec(bundleJs)?.[1];
if (!shapes) throw new Error("Couldn't find the shape data (var D = {...}) in components/bundle.js");
writeFileSync(join(styles, "shapes.json"), JSON.stringify(JSON.parse(shapes)) + "\n");

// Favicons: the SVG in this site's hue; the PNG fallbacks only come in the default teal.
const fav = join(src, "assets/Favicons");
copyFileSync(join(fav, `favicon-${SIG}.svg`), join(pub, "favicon.svg"));
for (const f of ["favicon-32.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png"]) {
	copyFileSync(join(fav, f), join(pub, f));
}
const manifest = JSON.parse(readFileSync(join(fav, "site.webmanifest.json"), "utf8"));
writeFileSync(join(pub, "site.webmanifest"), JSON.stringify({ ...manifest, name: "Family hub", short_name: "Family" }, null, 2) + "\n");

let rev = "unknown";
try {
	rev = execFileSync("git", ["-C", src, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
} catch {}
writeFileSync(
	join(styles, "VERSION"),
	`style.bridgewater ${rev}\nCopied by scripts/sync-style.mjs; edit the style repo, not these files.\n`,
);
console.log(`Synced style.bridgewater ${rev} from ${src}`);

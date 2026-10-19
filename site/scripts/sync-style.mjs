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
 * there first, re-run this, then commit the result. Rendering the green PNG
 * icons needs rsvg-convert (brew install librsvg).
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

// Favicons and app icons. The style ships the SVG favicon in every hue but the PNGs only in
// teal, so render this site's PNGs from the style's SVGs with teal swapped for SIG, using
// the hex values in tokens.json.
const tokens = JSON.parse(readFileSync(join(src, "tokens.json"), "utf8")).color.tokens;
const hex = (name, theme) => tokens.find((t) => t.name === name)?.value[theme];
const swaps = ["light", "dark"].flatMap((theme) =>
	["", "-bright", "-tint"].map((s) => [hex(`teal${s}`, theme), hex(`${SIG}${s}`, theme)]).filter(([a, b]) => a && b),
);
const recolor = (svg) => swaps.reduce((out, [from, to]) => out.replaceAll(from, to).replaceAll(from.toUpperCase(), to), svg);
const fav = join(src, "assets/Favicons");
copyFileSync(join(fav, `favicon-${SIG}.svg`), join(pub, "favicon.svg"));
const pngs = [
	["favicon-32.png", `favicon-${SIG}.svg`, 32],
	["apple-touch-icon.png", "apple-touch-icon.svg", 180],
	["icon-192.png", "app-icon.svg", 192],
	["icon-512.png", "app-icon.svg", 512],
	["icon-maskable-512.png", "app-icon-maskable.svg", 512],
	["og-image.png", "og-image.svg", 1200],
];
const tmp = join(tmpdir(), `sync-style-${process.pid}`);
mkdirSync(tmp, { recursive: true });
try {
	execFileSync("rsvg-convert", ["--version"], { stdio: "ignore" });
	for (const [png, svg, width] of pngs) {
		const file = join(tmp, svg);
		writeFileSync(file, recolor(readFileSync(join(fav, svg), "utf8")));
		execFileSync("rsvg-convert", ["-w", String(width), file, "-o", join(pub, png)]);
	}
} catch (e) {
	console.warn(`Could not render ${SIG} PNGs (${e.message.split("\n")[0]}); copying the style's teal ones.`);
	for (const [png] of pngs) copyFileSync(join(fav, png), join(pub, png));
} finally {
	rmSync(tmp, { recursive: true, force: true });
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

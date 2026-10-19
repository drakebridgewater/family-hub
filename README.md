# Bridgewater Family Hub

**social.example.com** is a mobile-first family landing page built *on* EmDash CMS.

| Visitor | Sees |
|---|---|
| Anyone | Family feed (EmDash posts, photos, comments) |
| Signed in via Authelia | Greeting, **app tiles filtered by their Authelia groups**, family schedule, feed |
| `family` / `extended-family` | Above + "Write a post" → EmDash editor as author / contributor (drafts) |
| `manage-social` group | Editor as admin (Authelia 2FA) |

## How sign-in works

```
Browser ──► Traefik ──► family-hub (public router, no middleware)
                │              │
                │              └─ server-side: forwards the visitor's cookie to
                │                 authelia:9091/api/authz/forward-auth as if for /login
                │                 200 → Remote-User / Remote-Groups → render apps
                │
                └─ /login router ──► default-secure@file (Authelia) ──► 302 back to /
```

The page never trusts `Remote-*` request headers. It asks Authelia itself, so a
forged header just gets the public view.

## Install on Unraid

1. Copy this folder to `/mnt/user/appdata/family-hub/` (so `site/` sits next to `docker-compose.yml`).
2. `cp .env.example .env`, then adjust the Traefik network, entrypoint, cert resolver and Authelia middleware names to match your setup.
3. Generate the encryption key and paste it into `.env`:
   ```bash
   cd /mnt/user/appdata/family-hub && docker compose build && docker run --rm family-hub:latest npx emdash secrets generate
   ```
4. Create the volume dirs owned by `nobody:users`:
   ```bash
   mkdir -p /mnt/user/appdata/family-hub/{data,uploads,config} && chown -R 99:100 /mnt/user/appdata/family-hub/{data,uploads,config}
   ```
5. Merge `authelia-access-control.yml` into Authelia's config and restart Authelia.
6. `docker compose up -d`. If you use the Compose Manager plugin instead, set `BUILD_CONTEXT=/mnt/user/appdata/family-hub/site`
   in its env, because its project folder lives on the flash drive.
7. Open `https://social.example.com/_emdash/admin`. Editor sign-in is Authelia (no EmDash passkeys); users are created
   on first visit, matched by email, with roles from their lldap groups.

## Day-to-day

- **Post an update:** EmDash admin → Posts → New. The *Short update* field is what shows in the feed card.
- **Family-only post:** turn on *Family only* when writing it. Visitors who aren't signed in won't see it in the feed,
  and its link shows a sign-in prompt instead. (Existing installs: add a Boolean field `members_only` to Posts once,
  under Content types.) Photos in it are still reachable by their direct URL.
- **Add or remove apps:** members of the `admin` group (set `ADMIN_GROUPS` to change it) use *Manage apps* in the
  account menu (`/admin/apps`). Each app can be **Shown** (people may hide it for themselves), **Always shown**, or
  **Hidden** from everyone. Until the first change there, apps come from `config/services.yaml` (seeded on first run
  from the tracked `config/services.example.yaml`, which holds placeholder hosts only); that first save copies
  them into Postgres and the file is no longer read. Icons: a [dashboard-icons](https://dashboardicons.com) name (guessed
  from the app name), an image URL, or an emoji.
- **Finding apps:** press `/` or ⌘K / Ctrl+K on any page (or the ▦ button in the header) to search apps. Each person
  can star favorites on *Customize home*; the rest then fold under "All apps".
- **Passwords & 2FA:** *Password & security* in the account menu opens Authelia's settings page (changing a password
  there needs Authelia 4.39+). Point `ACCOUNT_SECURITY_URL` elsewhere, e.g. lldap's change-password page, if you prefer.
- **Give someone access:** add them to Authelia's `users_database.yml` with `family` or `extended-family` groups.
  Tiles only *hide* links; each service still needs its own Authelia rule.
- **Schedule:** set `CALENDAR_FEEDS="Family|https://…ics,Kids|https://…ics"` (Google Calendar → *Secret address in iCal format*).

## What the site shows from EmDash

- **Menu:** the menu named `primary` (Menus in the admin) is the header navigation; a "Menu" button on phones.
- **Pages:** published pages at `/pages/<slug>`. Link them from the menu. Drafts don't show.
- **Categories & tags:** chips on posts, with listings at `/category/<slug>` and `/tag/<slug>`.
- **Widgets:** a widget area named `sidebar` shows in the desktop sidebar (under the feed on phones).
  Categories, Tags, Archives, Recent posts and Menu widgets work; Search needs SQLite, so skip it on Postgres.
- **Site settings:** title, tagline, logo and favicon. SEO and plugin head tags come from `<EmDashHead>`.

## Look and feel

The site uses the shared bridgewater.digital style ([style.bridgewater](https://github.com/drakebridgewater/style.bridgewater)),
with **green** as its signature hue. The header follows that guide: signature strip, wordmark and theme toggle, an ink rule,
then the prompt line `user@social:~/place`. The user name and `social` both lead back to the home page here, and the
path is the breadcrumb. Pages use the guide's layouts: Home (display greeting, numbered sections, the app grid, the
skyline), Settings for *Customize home*, Focus for sign-in prompts and Not found, and a page head on lists, posts and
*Manage apps*. Every color, size and font is a token; nothing in `src/` sets a hex value or a raw font size.

The style is vendored, not installed: `site/src/styles/bridgewater/` holds `bridgewater.css` (tokens and components),
its self-hosted Fira fonts, `tokens.json` (the head reads `theme-color` from it) and the shape data the Astro components
render, and `site/public/` holds the favicons, app icons, `og-image.png` and `site.webmanifest`. All of it is committed,
so the Docker build never fetches anything: the style repo is private and the build image has no git or credentials,
and a stylesheet loaded from another host would break the hub whenever that host is down. The favicon, app icons and
og-image are the style's own green set, copied from `assets/Favicons/green/`. After a new style release:

```bash
cd ../style.bridgewater && git checkout v1.x.y   # the release to take
cd ../family-hub/site && node scripts/sync-style.mjs ../../style.bridgewater   # or set STYLE_DIR
```

`src/styles/bridgewater/VERSION` records which release is in the build.

### The apps launcher in your other apps

Every bridgewater.digital app uses the style guide's header, whose apps button opens the same launcher as the hub.
Those apps load the list from the hub's `GET /api/apps`: the signed-in person's apps, favorites and order, or `401`
when signed out. The hub allows credentialed requests from `https://*.<parent domain>` (for `social.bridgewater.digital`,
any `https://*.bridgewater.digital`), so Authelia's session cookie must be scoped to that parent domain for the other
apps to send it. App paths like `/photos` come back as absolute URLs on the hub.

## Develop locally

```bash
cd site && npm install && cp config/services.example.yaml config/services.yaml && npm run dev
```

`config/services.yaml` is the file to edit with your real hostnames; it is git-ignored, so only the
placeholder `config/services.example.yaml` is ever committed.

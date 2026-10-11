# Bridgewater Family Hub

**social.bridgewater.digital** is a mobile-first family landing page built *on* EmDash CMS.

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
7. Open `https://social.bridgewater.digital/_emdash/admin`. Editor sign-in is Authelia (no EmDash passkeys); users are created
   on first visit, matched by email, with roles from their lldap groups.

## Day-to-day

- **Post an update:** EmDash admin → Posts → New. The *Short update* field is what shows in the feed card.
- **Family-only post:** turn on *Family only* when writing it. Visitors who aren't signed in won't see it in the feed,
  and its link shows a sign-in prompt instead. (Existing installs: add a Boolean field `members_only` to Posts once,
  under Content types.) Photos in it are still reachable by their direct URL.
- **Add or remove apps:** edit `/mnt/user/appdata/family-hub/config/services.yaml`. Changes apply on the next page load.
  `icon:` accepts a [dashboard-icons](https://dashboardicons.com) slug, an image URL, or an emoji.
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

## Develop locally

```bash
cd site && npm install && npm run dev
```

# Insta Pinmap

Your own world map of places from Instagram posts. Free, no account, and your
pins stay on your phone.

## What it does

Paste or share an Instagram link. The app reads the post's text, suggests where
the place is, you confirm, and the pin is on your map. Hashtags can become tags
with one tap. It also reads country flags and country/region words in the caption to put
the right place first, and shows each match's country flag.

- One post belongs to exactly one pin. Pasting the same link again jumps to it.
- Several posts can share a pin. If a new place is close to pins you already
  have, the app asks whether to attach it to one of them.
- You always confirm the place, even when there is only one match.

Also: list with search, tag filter, notes, "want to go / been there", and import
from Apple Guides, Apple and Google Maps links, Google Takeout, My Maps
(KML/KMZ), GPX and GeoJSON.

## Install

Open the app's address in the browser once, then:

- **iPhone (Safari):** Share button → **Add to Home Screen**. Always open the app
  from that icon — iPhone keeps the home-screen app's data separately and safely.
- **Android (Chrome):** menu ⋮ → **Install app** (or "Add to Home screen").

After the first start the app works without internet, except for map images,
place search and reading Instagram posts.

## Adding a place

- **Android:** in Instagram tap Share → **Insta Pinmap**. If it isn't in the list,
  use the iPhone way.
- **iPhone:** in Instagram tap Share → **Copy link**, open Insta Pinmap, tap the
  paste button next to the input field and confirm iPhone's "Paste" bubble.
- You can also type a place name, or paste an Apple or Google Maps link.

If the app can't read a post, it shows the post and you search for the place
yourself. Everything else keeps working.

## Your data and backups

Your pins are stored in the app on your phone. Nothing is uploaded.

- **Settings → Backup → Save backup** downloads one HTML file. Open it to see your
  map; load it in the app to get your pins back. Keep it in Files, iCloud Drive or
  Google Drive.
- **Load backup** asks: **Add to my pins** (keeps yours, adds the backup's, pins
  you deleted stay deleted) or **Replace everything**.
- If your last backup is older than 30 days, the app reminds you.
- Removing the app from the home screen deletes its pins. Save a backup first.

## Updates

The app never updates by itself. A small dot on the settings button means a new
version exists. **Settings → App → Check for updates → Install.**

## Privacy

- Pins, notes and tags never leave your phone.
- Reading a post sends only the post's code to the app's helper on Cloudflare,
  together with a small computed "work ticket" that keeps scripts from misusing it.
- Short map links (maps.app.goo.gl, maps.apple) are expanded by the same helper;
  it sees the short link, where it points to, and your IP address.
- Opening a saved post shows Instagram's own embedded view, so Instagram sees that request.
- Place search goes directly to Photon (komoot) and Nominatim (OpenStreetMap).
- Map images come from OpenStreetMap.
- Search engines are asked not to list the app (robots.txt and noindex).

## When something doesn't work

Open **Settings → Diagnostics → Self-test**. It checks everything one by one and
says what is wrong.

| Problem | What to do |
|---|---|
| "Couldn't read this post." | Instagram changed something. Search for the place yourself. |
| Grey map | No internet, or the map server is slow. |
| "Place search isn't responding." | Photon and Nominatim are down. Try again later. |
| "Couldn't save. Please save a backup." | Phone storage is full or blocked (private browsing?). |

## Run your own copy

Insta Pinmap is meant for personal use: everyone runs their **own** copy on
their **own** free Cloudflare account. It takes about 15 minutes.

1. Install Node.js (the LTS version) from <https://nodejs.org>.
2. Create a free account at <https://dash.cloudflare.com>. Open **Workers & Pages**
   once and pick a `workers.dev` subdomain. Choose a neutral name: it becomes part
   of your app's address and anyone can see it.
3. Download this project (or clone it) and open a terminal in its folder.
4. Log in once: `npx --yes wrangler@4 login` (opens your browser).
   Alternative: create an API token with the template **"Edit Cloudflare Workers"**
   and provide it as the environment variables `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID`. Keep the token private and never put it in a file
   that goes into git.
5. Optional: change `name = "insta-pinmap"` in `wrangler.toml` — the name is part
   of your address.
6. Deploy: `npx --yes wrangler@4 deploy`. At the end it prints your address,
   `https://<name>.<your-subdomain>.workers.dev`.
7. Open that address on your phone and install the app (see "Install").

Good to know:
- Cloudflare's free plan allows 100,000 requests a day; one added post or short link is one request.
- `WORK_DIFFICULTY` in `wrangler.toml` sets how much work a phone does per post
  (about 1–2 seconds at 20 on a computer; phones can be slower). Lower it if adding
  a post feels slow on your phone.
- To update your copy later: download the new version and run the deploy again.

## Disclaimer

- **Personal, non-commercial use only.** This is a hobby project, not a product
  or a service. No warranty, no support, use at your own risk.
- **Don't use someone else's copy.** Do not use another person's deployment (their
  address) or their Cloudflare account or credentials. Deploy your own copy as
  described above.
- **Instagram:** reading a post uses an unofficial way Instagram shows post
  previews to search engines. It can stop working at any time and may not be in
  line with Instagram's terms. Use it only for posts you save for yourself, at
  personal volume, and respect the people who made them.
- **Map services:** respect the usage policies of OpenStreetMap, Nominatim and
  Photon. The app already keeps to their request limits; please don't change that.

## For developers

- `web/` — the app: plain HTML, CSS and ES modules, no build step.
- `worker/` — the Cloudflare Worker: `/api/ig` and `/api/resolve`.
- Tests: `node --test "test/*.test.mjs" "worker/*.test.mjs"` (Node 24, no install).
- Local run: `npx --yes wrangler@4 dev`, then open `http://127.0.0.1:8787`.

Third-party libraries in `web/vendor/` (Leaflet, Leaflet.markercluster, fflate,
@tmcw/togeojson) keep their own license files next to them.

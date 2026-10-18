# oPin

oPin is one map for places from many sources: Apple Maps, Google Maps and other
map apps, map files and spreadsheets, and posts from Instagram, TikTok, YouTube
and Facebook. Free, no account, and your pins stay on your phone.

## What it does

The app brings places from map apps, map files and posts onto one map, and you
check what it found before anything is saved.

| Import from | Where the places come from |
|---|---|
| Apple Guides and Apple Maps places | The link itself. Places a guide names only by an Apple Maps ID are looked up from your phone or computer (see "Apple Guides"). |
| Google Maps links | The link itself; short links are expanded by the app's helper. |
| Google Maps shared lists (only lists shared with "Anyone with the link") | The list, read by the app's helper; its places (up to 1,000) open in one import list. |
| Links from other map apps: OpenStreetMap, Organic Maps / CoMaps, Waze, HERE WeGo, Mapy, Bing Maps | The link itself. An OpenStreetMap object (node, way, relation) is looked up on OpenStreetMap; Mapy short links are expanded by the app's helper. |
| Coordinates, `geo:` links and Plus Codes, typed or pasted | The text itself: the exact point. A short Plus Code with a town ("4HX8+QH Munich") is placed near that town. |
| Google Maps saved places and lists (the GeoJSON and CSV files from the Google Takeout zip, not the zip itself; older and newer Takeout files) | The file itself; places without coordinates are searched by name on import, never put at 0,0. |
| Spreadsheets (CSV, TSV, Excel files saved with `;` and decimal commas) with coordinate or address columns | The file itself; rows without coordinates are searched by name on import. |
| My Maps (KML/KMZ), GPS files (GPX), GeoJSON | The file itself. |
| Instagram posts | The post's text and location tag, read by the app's helper (see below). |
| TikTok videos | The video's caption, read from your phone through TikTok's oEmbed. |
| YouTube videos and Shorts | The video's title, description and location tag, read by the app's helper. |
| Public Facebook posts, reels and pages | A post's or reel's text, or a page's map pin and address, read by the app's helper. |

The input bar takes one link at a time: an Instagram, TikTok, YouTube or
Facebook link, a map app's place, an Apple Guide or a Google Maps list; or
coordinates, a `geo:` link or a Plus Code. Several map links at once go in through
**Settings → Import** (one per line; they open one import list), files through
**Settings → Import → Choose files**. The import list puts a tag with the
guide's, list's or file's name on every place it imports; change or clear it
before you tap **Import selected**. With the tag filter you then show or hide a
whole guide at once.

A pin takes the colour of where it came from (Instagram, TikTok, YouTube,
Facebook, Apple Maps, Google Maps, other map apps and coordinates, GPS files,
other map files, a typed search); pick another one in **Confirm place**, the
import list or the pin's details (**Auto** goes back to it).

A link to a site the app doesn't read yet (Pinterest, say) opens a
dialog that says so, offers a search of the project's GitHub issues for that
site, and lists every supported link and file.

**Instagram posts:** paste or share a link. The app reads the post's text,
suggests where the place is, you confirm, and the pin is on your map. Hashtags
can become tags with one tap. It also reads country flags and country/region
words in the caption to put the right place first, and shows each match's
country flag. If a post mentions a date, the app suggests it; you can edit it.
Each post also keeps the date it was published. If the post has a location tag,
that place comes first in **Confirm place** ("Tagged location"), with the
caption's places below.

- One post belongs to exactly one pin. Pasting the same link again jumps to it.
- Several posts can share a pin. If a new place is close to pins you already
  have, the app asks whether to attach it to one of them.
- You always confirm the place, even when there is only one match.

**TikTok, YouTube and Facebook** go the same way: paste or share a link, the app
reads the caption or description, suggests places, and you confirm. A YouTube
video's location tag is searched first. A Facebook page with a map pin gives the
exact place, and the page's link goes into the pin's note. Videos and posts stay
on their pin like Instagram posts.

Also: list with search, tag filter and notes (a new place without other tag
suggestions offers the tag "want-to-go"). The only export is the app's own
backup: one HTML file that shows your pins on a map and, loaded in the app,
brings them back (see "Your data and backups").

## What needs the helper

The app runs on your phone. Its helper is the small server part on Cloudflare
(a Worker, at the `/api/…` addresses of your copy). Only these things use it:

- reading Instagram posts (`/api/ig`),
- reading YouTube videos and Facebook posts, reels and pages (`/api/post`),
- reading shared Google Maps lists (`/api/list`),
- expanding short links (`/api/resolve`): Google Maps ones such as maps.app.goo.gl,
  pasted or in an imported file; Mapy ones (mapy.com/s/…); and TikTok ones
  (vm.tiktok.com, vt.tiktok.com, tiktok.com/t/…) when TikTok's oEmbed won't take them,
- a guide shared from the Maps app to the iPhone Shortcut (`/api/guide`).

Everything else runs on your phone alone: file imports, coordinates, `geo:` links
and Plus Codes, long Apple and Google Maps links, other map apps' links, Apple
Guide links, the Shortcut from Safari or from the app's button, and backups.
TikTok captions come straight from TikTok's oEmbed, and OpenStreetMap objects
straight from OpenStreetMap (Nominatim). Place search and map images go straight
from your phone to Photon, Nominatim and the map servers.

So if Meta blocks a Worker, only reading Instagram and Facebook posts stops.
YouTube, TikTok and Google can block a Worker separately; then only what the
helper does for them stops (a YouTube video still gives its title, read straight
from YouTube; a Google list can still come in as its Takeout file). Everything
else keeps working. Even then you can save a post: the app shows it, and you
search for the place yourself.

## Install

Open your copy's address (see "Run your own copy") in the browser once, then:

- **iPhone (Safari):** Share button → **Add to Home Screen**. Always open the app
  from that icon — iPhone keeps the home-screen app's data separately and safely.
- **Android (Chrome):** menu ⋮ → **Install app** (or "Add to Home screen").

After the first start the app works without internet, except for map images,
place search, reading posts and Google lists, and short links.

## Adding a place

- **Android:** in Instagram tap Share → **oPin**. If it isn't in the list,
  use the iPhone way.
- **iPhone:** in Instagram tap Share → **Copy link**, open oPin, tap the
  paste button next to the input field and confirm iPhone's "Paste" bubble.
- You can also type a place name, or paste one link from TikTok, YouTube,
  Facebook or a map app (an Apple Guide or a Google Maps list too), coordinates
  or a Plus Code.

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

### Moving from the old address

oPin used to be Insta Pinmap at `insta-pinmap.<subdomain>.workers.dev`; it now lives at
`opin.<subdomain>.workers.dev`. Pins are stored per address, so the old address keeps working
and shows a banner: **Save backup** there, open the new address (**Open the new address**) and
add it to your Home Screen, then there **Settings → Import → choose the backup**.

## Apple Guides

An Apple Guide link carries the name and coordinates of places you added as an
address or a pin. Places Apple Maps itself knows (shops, cafés, sights) are in
the link only as an ID, and Apple doesn't share them with the app's helper, so
they are looked up from your iPhone (Option A) or a computer (Option B). Paste a
guide link straight into the app and the import dialog lists them as unchecked
"Apple Maps place" rows until they are looked up.

### Option A — iPhone Shortcut

One Shortcut does it all: **Fetch Apple Guide**. Open
<https://www.icloud.com/shortcuts/6aeae7fdbdc94bffb0273030edffdd92> on your
iPhone and tap **Add Shortcut**. Keep the name: the app's **Look up with iPhone
Shortcut** button starts it by that name. The app has the same link, plus the
tips below, under **Shortcut help** in the import dialog and in **Settings →
Import**.

Set up once:

- Not in the Share menu after adding it? Restart the iPhone.
- For Safari: **Settings → Shortcuts → Advanced** (iOS 18 and later:
  **Settings → Apps → Shortcuts → Advanced**), turn on **Allow Running Scripts**
  and **Allow Sharing Large Amounts of Data**.
- On the first run, tap **Always Allow** whenever it asks "Allow … to send …?"
  (once for the app's address, once for maps.apple.com).
- Running your own copy? Point the Shortcut at it first (see "Point the Shortcut
  at your copy").

Then share to it (Share → **Fetch Apple Guide**) from:

- **Safari, on an Apple Maps guide page** (`maps.apple.com/guides?user=…`): a
  script on the page reads the guide and fetches the remaining places. About 5
  seconds.
- **The Maps app, a guide:** the Shortcut asks the app's helper for the guide's
  place links (`/api/guide`; the helper reads them out of the link itself and
  never contacts Apple), then fetches each place page from your phone. Big
  guides take 10–30 seconds.
- **Maps or Safari, a single place:** the Shortcut hands over the place link.

In every case the result goes to the clipboard. Open oPin, tap the paste
button next to the input field and confirm iPhone's "Paste" bubble (or, with the
import dialog open, tap **Paste results**). A guide opens the import dialog with
its places: tap **Import selected**. A single place opens **Confirm place**, as
any map link does.

Why the clipboard: iOS can't open a home-screen web app from a Shortcut, and the
home-screen app keeps its data apart from Safari.

A place Apple Maps no longer knows can't be found. In a test with a 49-place
guide, 47 places came back; the other 2 no longer exist at Apple. The import
dialog says how many are missing and keeps them unchecked; its button (**Look up
with iPhone Shortcut**, later **Try the … places again**) runs the Shortcut for
just those, in case Apple only refused a few pages.

You can still start in the app:

1. Paste the guide link into the app's input bar; the import dialog opens.
2. Tap **Look up with iPhone Shortcut**: the app copies the place links and
   starts the Shortcut. If Shortcuts doesn't open, tap **Open Shortcuts** below
   the buttons. If iPhone asks whether Shortcuts may paste, tap **Allow Paste**.
3. Go back to the app and tap **Paste results** (or just paste into the app's
   input bar), then **Import selected**.

If the app was closed meanwhile, it offers **Continue the Apple Guide import**
(for 24 hours), with the places already found.

### Option B — computer

With Node.js installed, in this project's folder:

```
node tools/apple-guide.mjs "<guide link>"
```

This stays the way without an iPhone. It fetches the guide page once (and looks
up any place the page lacks, one per second) and writes `<guide title>.geojson`
with all places of the guide (or give a file name as a second argument). Load
that file in the app: **Settings → Import → Choose files**. To get it onto the
phone, send it via AirDrop, iCloud Drive or mail.

## Updates

The app never updates by itself. A small dot on the settings button means a new
version exists. **Settings → App → Check for updates → Install.**

## Privacy

- Pins, notes and tags never leave your phone.
- Reading an Instagram post sends only the post's code to the app's helper on
  Cloudflare, together with a small computed "work ticket" that keeps scripts from
  misusing it.
- Reading a YouTube video or a Facebook post, reel or page sends its link to the
  same helper, with the same kind of work ticket. The helper fetches the page from
  YouTube or Facebook (for a YouTube location tag, also that place's Google Maps
  page). It sees the link and your IP address, and stores and logs neither.
- A Google Maps list link goes to the helper too: it asks Google for the list by
  its ID and passes on the places' names, addresses, coordinates and notes, never
  who owns the list or added a place. It sees the list link and your IP address,
  and stores and logs neither.
- Short Google Maps links (maps.app.goo.gl, goo.gl/maps), Mapy short links and the
  TikTok short links TikTok's oEmbed won't take are expanded by the same helper; it
  sees the short link, where it points to, and your IP address.
- A TikTok caption comes straight from your phone through TikTok's oEmbed, so
  TikTok sees that request. If the helper can't read a YouTube video, the app asks
  YouTube's oEmbed for its title the same way; a video's picture also comes
  straight from YouTube.
- OpenStreetMap objects from map links are looked up straight from your phone on
  Nominatim (or the OpenStreetMap API).
- Apple Maps places of an Apple Guide are looked up by the iPhone Shortcut or the
  computer script (see "Apple Guides"), straight from your own connection to Apple Maps.
- A guide shared from the Maps app to the Shortcut goes to the app's helper once: it
  reads the place IDs out of the link and answers with the place links. It sees the
  guide link (title, your pins' names, addresses and coordinates) and your IP address,
  and stores and logs neither.
- Against misuse, the helper only counts requests per address for a minute.
- Opening a saved post shows Instagram's own embedded view, so Instagram sees that request.
  If a post can't be read, **Confirm place** shows the site's own embedded view
  (Instagram, TikTok, YouTube or Facebook), so that site sees the request.
- Place search goes directly to Photon (komoot) and Nominatim (OpenStreetMap).
- Map images come from OpenStreetMap (or OpenTopoMap, if you pick that map style).
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

The public copy is the author's personal one, not a service. Your own copy
matters most for Instagram and Facebook: Meta can block a Worker's address at any
time, and then reading their posts stops for everyone who uses that copy (see
"What needs the helper"). So everyone runs their **own** copy on their **own** free
Cloudflare account: your Worker, your limits. It takes about 15 minutes.

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
5. Optional: change `name = "opin"` in `wrangler.toml` — the name is part
   of your address. If another Worker on your account already uses rate-limit
   namespace `1001`, `1002`, `1003` or `1004`, change those numbers too (see "Rate limits").
6. Deploy: `npx --yes wrangler@4 deploy`. At the end it prints your address,
   `https://<name>.<your-subdomain>.workers.dev`.
7. Open that address on your phone and install the app (see "Install").
8. Using the iPhone Shortcut for Apple Guides? Point it at your copy (next section).

### Point the Shortcut at your copy

As installed, the Shortcut **Fetch Apple Guide** (see "Apple Guides") asks the
author's copy for a guide's place links when you share a guide from the Maps
app. Change that once:

1. In the Shortcuts app, tap **•••** on **Fetch Apple Guide** to edit it.
2. Find the **URL** action with `/api/guide?link=` in it. As shared it points at the author's
   copy, `https://opin.<subdomain>.workers.dev`, or still at the old
   `https://insta-pinmap.<subdomain>.workers.dev` until the Shortcut is shared again; check it
   either way.
3. Replace the address in front of `/api/guide` with yours, so it starts with
   `https://<name>.<your-subdomain>.workers.dev/api/guide?link=`. Leave the rest
   of the action as it is.

On the next run from Maps, tap **Always Allow** for your address. If you add the
Shortcut again later (say, a newer version), change the URL again.

### Rate limits

`wrangler.toml` limits how often one IP address may call your helper:

| Binding | `namespace_id` | Limit per address | For |
|---|---|---|---|
| `IG_LIMIT` | `1001` | 20 a minute | reading Instagram posts (`/api/ig`), and separately short links (`/api/resolve`) |
| `GUIDE_LIMIT` | `1002` | 30 a minute | guide place links (`/api/guide`) |
| `LIST_LIMIT` | `1003` | 20 a minute | Google Maps lists (`/api/list`) |
| `POST_LIMIT` | `1004` | 20 a minute | YouTube videos and Facebook posts (`/api/post`) |

Over the limit, the helper answers "Too many requests. Wait a minute and try again."

- `namespace_id` must be unique within your Cloudflare account: bindings with the
  same number share their counters. If another Worker of yours already uses one of
  `1001` to `1004`, pick other numbers (any positive whole number, in quotes).
- If `wrangler deploy` rejects the `[[ratelimits]]` blocks, delete them. The
  Worker then counts in its own memory, with the same limits; that is rougher,
  but it works.

### Good to know

- Cloudflare's free plan allows 100,000 requests a day; one added post, short link,
  Google list or guide shared from the Maps app is one request.
- `WORK_DIFFICULTY` in `wrangler.toml` sets how much work a phone does per
  Instagram, YouTube or Facebook post (about 1 second at 18 on a phone; raise it
  only if your phone is fast).
- Search engines are already asked to stay away: `web/robots.txt` disallows
  everything, and every page and answer says "noindex" (`web/_headers`, the
  page's robots tag, the Worker). Nothing to set up. Your address still isn't a
  secret: anyone who has it can open the app.

### Updating your copy

1. Download the new version (or `git pull`). Keep your changes to `wrangler.toml`
   (name, `namespace_id`s). Keeping the old `name = "insta-pinmap"`? Then set
   `MOVED_TO_OPIN = false` in `web/js/sources.js`, or the app shows a move banner that points at an
   `opin` address you don't have.
2. Deploy again: `npx --yes wrangler@4 deploy`.
3. On your phone: **Settings → App → Check for updates → Install** (see "Updates").

## Disclaimer

- **Made for personal use.** This is a hobby project, not a product or a
  service. No warranty, no support, use at your own risk (see "License").
- **Don't use someone else's copy.** Do not use another person's deployment (their
  address) or their Cloudflare account or credentials. Deploy your own copy as
  described above.
- **Instagram:** reading a post uses an unofficial way Instagram shows post
  previews to search engines. It can stop working at any time and may not be in
  line with Instagram's terms. Use it only for posts you save for yourself, at
  personal volume, and respect the people who made them.
- **YouTube, Facebook and TikTok:** these are read in unofficial ways too, much
  like Instagram: the helper reads YouTube's and Facebook's public pages, and the
  app asks TikTok's embed information. Any of it can stop working at any time and
  may not be in line with their terms. The same rules apply: only posts you save
  for yourself, at personal volume.
- **Google Maps lists** are read through an undocumented address of Google Maps;
  that, too, can stop working at any time.
- **Map services:** respect the usage policies of OpenStreetMap, Nominatim and
  Photon. The app already keeps to their request limits; please don't change that.

## For developers

- `web/` — the app: plain HTML, CSS and ES modules, no build step.
- `worker/` — the Cloudflare Worker: `/api/ig`, `/api/resolve`, `/api/guide`,
  `/api/list` and `/api/post`.
- `web/js/sources.js` lists every source: its link prefixes, pin colour and the
  dialog's supported links and files. A new source is one more entry there.
- Readers added in 2.2.0: `web/js/coords.js` (coordinates, `geo:`, Plus Codes),
  `maplinks.js` (other map apps), `csvcolumns.js` (CSV/TSV columns),
  `googlelist.js` (Google lists), `tiktok.js` (TikTok's oEmbed) and `postlinks.js`
  (YouTube and Facebook links, shared with the Worker); in the Worker
  `iglocation.js` (an Instagram post's location tag, which `/api/ig` now returns
  as `locationTag`; `location` stays the tag's name, as older apps expect it),
  `googlelist.js` and `post.js`.
- `GET /api/list?link=<list link>` answers the list's title, its total and up to
  1,000 of its places as JSON (one request to Google by the list's ID, read up to
  1.5 MB); 400 for a link without a list ID, 404 for a list not shared with
  "Anyone with the link", 502 when Google doesn't send it or its answer is too
  big, 429 over the rate limit.
- `GET /api/post?url=<link>&m=<minute>&n=<nonce>` answers a YouTube video's text
  and location tag, a Facebook post's text or a Facebook page's map pin, as JSON.
  Its work ticket is computed over the link's post key (`yt:…`, `fb:…`), as
  `/api/ig`'s is over the shortcode; 400 for another link, 403 for a missing or
  expired ticket, 429 over the rate limit.
- `GET /api/guide?link=<guide link>` (the Shortcut's Maps-app path; URL-encoded,
  or raw as the last parameter) answers, as plain text, one
  `https://maps.apple.com/place?auid=<id>` line per Apple Maps place, read from the
  link itself; 400 for a link without any, 429 over the rate limit.
- What the app reads back from the Shortcut (`web/js/appleplace.js`): Apple Maps
  place pages, whole or cut after `</head>` (a place link line above each page ties
  it to its place); a guide page; or `<place link>@@<name>@@<lat>@@<lon>@@<address>`
  lines. A guide link as the first line names the guide they belong to.
- The app version is in `web/version.json` and `web/js/version.js` (a test checks
  they match); `version.json` also lists every file the app keeps offline.
  `web/sw.js` must stay byte-for-byte the same between versions, so phones update
  only through **Settings → App**.
- `tools/apple-guide.mjs` — Apple Guide → GeoJSON on a computer (see "Apple Guides").
- Tests: `node --test "test/*.test.mjs" "worker/*.test.mjs"` (Node 24, no install).
- Local run: `npx --yes wrangler@4 dev`, then open the address it prints
  (`http://localhost:8787`).

Third-party libraries in `web/vendor/` (Leaflet, Leaflet.markercluster, fflate,
@tmcw/togeojson) keep their own license files next to them.

## License

Copyright (C) 2026 oPin contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the full text in [`LICENSE`](LICENSE).

In short: you may use, change and share it, also commercially; if you share a
changed version, you share its source under the same license. The libraries in
`web/vendor/` keep their own (GPL-compatible) licenses.

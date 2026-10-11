# Insta Pinmap

Your own world map of places from Instagram posts. Free, no account, and your
pins stay on your phone.

## What it does

Paste or share an Instagram link. The app reads the post's text, suggests where
the place is, you confirm, and the pin is on your map. Hashtags can become tags
with one tap. It also reads country flags and country/region words in the caption to put
the right place first, and shows each match's country flag.
If a post mentions a date, the app suggests it; you can edit it. Each post also
keeps the date it was published.

- One post belongs to exactly one pin. Pasting the same link again jumps to it.
- Several posts can share a pin. If a new place is close to pins you already
  have, the app asks whether to attach it to one of them.
- You always confirm the place, even when there is only one match.

Also: list with search, tag filter, notes, "want to go / been there", and import
from Apple Guides, Apple and Google Maps links, Google Takeout, My Maps
(KML/KMZ), GPX and GeoJSON.

| Import from | Where the places come from |
|---|---|
| Apple Guides | Names and coordinates come from the link; places Apple Maps knows are looked up from your phone or computer (see "Apple Guides"). |
| Apple and Google Maps links | The link itself; short links are expanded by the app's helper. |
| Google Takeout, Google list CSV, My Maps, GPX, GeoJSON | The file itself. |

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

## Apple Guides

An Apple Guide link carries the name and coordinates of places you added as an
address or a pin. Places Apple Maps itself knows (shops, cafés, sights) are in
the link only as an ID. Apple doesn't share them with the app's helper, so the
import dialog shows them as unchecked "Apple Maps place" rows and offers two ways
to look them up.

### Option A — iPhone Shortcut

Build it once in the Shortcuts app (action names as in the English Shortcuts app).
Shortcuts app → **+** → name the shortcut exactly **Fetch Apple Guide**, then add
six actions:

```
1  Get Clipboard
2  URL [Clipboard]
3  Get Contents of URL [URL]
4  Set Name of [Contents of URL] to [page.txt]
5  Get Text from [Renamed Item]
6  Copy [Text] to Clipboard
```

Step 2 matters: without the URL action, Shortcuts (seen on iOS 16) detects the
link inside the text and cuts long guide links short, and Apple then shows an
empty guide ("0 places"). Step 4 makes the Shortcut hand over the raw page source instead of the rendered
text; step 5 puts it on the clipboard as plain text, not as a file. The guide page names every place of the guide, so one fetch is enough; the
app reads names, addresses and coordinates out of it itself.

On the first run, tap **Always Allow** when the Shortcut asks to connect to
guides.apple.com and maps.apple.com, and **Allow Paste** (to stop being asked:
Settings → Apps → Shortcuts → Paste from Other Apps → Allow).

**Check it once:** copy your guide link, run the Shortcut, paste into Notes — you
should see page source that contains `mw-collection-place-name`.

Then:

1. Paste the guide link in the app (input field or **Settings → Import**); the
   import dialog opens.
2. Tap **Look up with iPhone Shortcut**: the app copies the guide link and starts
   the Shortcut. If Shortcuts doesn't open, tap **Open Shortcuts** below the buttons.
3. Go back to the app and tap **Paste results**, then **Import selected**.

After the Shortcut, tap Paste results in the import dialog — or just paste into the app's input bar; both work.

If the app was closed meanwhile, it offers **Continue the Apple Guide import**
(for 24 hours). The Shortcut fetches the page from your phone's own connection.
The app copies the guide link in a form without special characters, because iOS can shorten links that contain %2F.

**Paste results** still reads the output of the longer Shortcuts from earlier
versions (one place page per Apple Maps place, or
`<place link>@@<name>@@<lat>@@<lon>@@<address>` lines). The **Look up with iPhone
Shortcut** button, however, needs the Shortcut named exactly **Fetch Apple Guide**:
rebuild it as the six actions above.

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
- Reading a post sends only the post's code to the app's helper on Cloudflare,
  together with a small computed "work ticket" that keeps scripts from misusing it.
- Short map links (maps.app.goo.gl, maps.apple) are expanded by the same helper;
  it sees the short link, where it points to, and your IP address.
- Apple Maps places of an Apple Guide are looked up by the iPhone Shortcut or the
  computer script (see "Apple Guides"), straight from your own connection to Apple Maps.
  The app's helper is not involved.
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
  (about 1 second at 18 on a phone; raise it only if your phone is fast).
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
- `tools/apple-guide.mjs` — Apple Guide → GeoJSON on a computer (see "Apple Guides").
- Tests: `node --test "test/*.test.mjs" "worker/*.test.mjs"` (Node 24, no install).
- Local run: `npx --yes wrangler@4 dev`, then open `http://127.0.0.1:8787`.

Third-party libraries in `web/vendor/` (Leaflet, Leaflet.markercluster, fflate,
@tmcw/togeojson) keep their own license files next to them.

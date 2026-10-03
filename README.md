# Ortsammlung

Ortsammlung (German for "place collection") is a personal world map for places
from Instagram posts. It runs only on your own devices: no account, no hosting,
no running costs, no data anywhere on the internet.

---

## What the app does

You paste an Instagram link. The app fetches the post's text, looks for a place
in it, suggests matches on a map, **you confirm**, and the pin is set. You can
take over tags from the post's hashtags with one tap.

- **A post belongs to exactly one pin.** Pasting the same link a second time
  does not create a second pin; it jumps to the existing one.
- **Several posts may hang on one pin.** If a new place lands close to an
  existing one, the app asks whether the two belong together. If you say no,
  you simply have two pins close to each other, and you will not be asked
  again for that pair.
- **You always confirm**, even when there is a single unambiguous match.

Plus: a list view with full-text search, tag filters, a note and "Want to go /
Been there" per place, and import from Apple Guides, Apple and Google Maps
links, Google Takeout, My Maps (KML/KMZ), GPX and GeoJSON.

---

## Why a small server instead of a single HTML file

An HTML file that you tap in the file manager runs under the `file://` origin.
There, the following applies:

- Android shares browser storage between **all** local HTML files, so any
  other local page can read and overwrite your pins.
- No service worker, so no app icon on the home screen and no entry in the
  share menu.
- Instagram cannot be queried from the browser at all (CORS).

If the same page comes from `http://127.0.0.1` instead, Chrome treats it as a
secure origin: its own separate storage, installable, and the server may query
Instagram over your own connection. Hence the detour through roughly 700 lines
of Node. The app itself stays plain HTML, CSS and JavaScript with no build step.

The server has **not a single npm dependency**. Only Node built-ins. There is
nothing that could go stale or need security updates.

---

## Setup: Windows

1. **Install Node.js**, once, from <https://nodejs.org>. The LTS version is
   enough. Just click through the installer.
2. **Double-click `start-windows.cmd`.** A black window opens, and the browser
   opens by itself.

Done. The black window has to stay open while you use the app. To quit, close
the window or press `Ctrl`+`C`.

On WSL or Linux, use `./start.sh` instead.

---

## Setup: Android

About 15 minutes, once; after that everything starts by itself.

### 1. Install Termux

**Important: not from the Play Store.** The version there is outdated and does
not work. Use F-Droid:

- <https://f-droid.org/packages/com.termux/>: download and install the APK
  (Android asks once for permission to install apps from this source).
- Additionally **Termux:Boot** from the same source, if the app should start
  by itself after the phone restarts:
  <https://f-droid.org/packages/com.termux.boot/>

### 2. Install Node

Open Termux and type:

```bash
pkg update && pkg install nodejs
```

### 3. Get the folder onto the phone

Copy the whole project folder to `Downloads` by cable, cloud or wireless
transfer. Then in Termux:

```bash
termux-setup-storage          # asks once for file access
cp -r ~/storage/downloads/insta-pinmap ~/
cd ~/insta-pinmap
chmod +x start-termux.sh stop-termux.sh
```

### 4. Start

```bash
./start-termux.sh
```

Then open Chrome and go to `127.0.0.1:8080`.

### 5. Put it on the home screen as an app

In Chrome, tap the three-dot menu → **"Add to Home screen"** or **"Install
app"**. After that you have your own icon, and the app starts without an
address bar.

### 6. Start automatically

```bash
mkdir -p ~/.termux/boot
cat > ~/.termux/boot/ortsammlung <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
cd ~/insta-pinmap && ./start-termux.sh --hintergrund
EOF
chmod +x ~/.termux/boot/ortsammlung
```

For this, Termux:Boot must have been started by hand once.

### 7. Turn off battery saving

Android likes to kill background services on its own. Under
**Settings → Apps → Termux → Battery**, set it to **"Not optimized"** or
**"Unrestricted"**. Otherwise the server is gone after a few hours.

---

## Instagram → Share → Ortsammlung

Once the app is installed, it should show up in Instagram's share menu. A post
you share there lands directly in the form.

**If it does not appear there:** Chrome decides that, and for an app installed
via localhost it is not guaranteed. The fallback costs one extra tap and always
works:

1. In Instagram, tap Share → **Copy link**
2. Open the Ortsammlung. It detects the link in the clipboard and inserts it by
   itself. Otherwise tap the clipboard icon next to the input field.

---

## Where the data lives

Everything is in **one file**: `data/pins.json` next to the program. It is
created empty on first start and is excluded from Git, so your places never
end up in the repo.

For trying things out, `data/pins.example.json` with made-up places is
included. As long as `pins.json` is still empty, just copy the example file
over it and start the server:

```bash
cp data/pins.example.json data/pins.json
```

- Before every write, the previous version moves to `data/backups/`; the last
  20 are kept.
- Writes are atomic (first to a side file, then renamed). A power cut in the
  middle of saving cannot tear the file apart.
- If `pins.json` does get broken, the server sets it aside and restores from
  the most recent usable backup, instead of silently showing you an empty map.
- The browser also keeps an emergency copy. If the server does not respond, you
  keep working and the changes are synced on the next start.

Under **Settings → Backup** there is also:

- **Back up as JSON**: the file, to copy somewhere safe.
- **As a standalone HTML map**: a single file with all pins baked in. Opened by
  double-click, it shows the complete map, without a server, without anything.
  For viewing only; editing happens in the real app.

**The only way to sync data between phone and computer is this JSON file.**
There is deliberately no synchronization.

---

## Importing existing places

Under **Settings → Import**.

| Source | Where from | Coordinates |
|---|---|---|
| **Apple Guides** | In Apple Maps, share the guide → copy link → paste into the link field | included directly |
| Apple place links | Share a single place | usually directly |
| **Google Takeout** | takeout.google.com → "Maps (your places)" → `Saved Places.json` | included directly |
| Google lists | takeout.google.com → "Saved" → one CSV per list | missing; read from the link or looked up |
| **Google My Maps** | Open the map → menu → "Export to KML/KMZ" | included directly |
| GPX, GeoJSON, KML, KMZ | any source | included directly |

Everything lands in the same overview, where you choose what to take over.
Places that are closer than 60 m to an existing pin are silently skipped.

**Apple Maps has no export of favorites or guides as a file.** The detour via
the shared guide link is the only one that works, but it really does contain
names, addresses and exact coordinates.

---

## When something does not work

First open **`/selftest.html`** (also reachable via Settings → Diagnostics). The
page checks everything in turn and tells you what the cause is, instead of
leaving you to guess.

You can test the Instagram fetch there with a real post:

```
http://127.0.0.1:8080/selftest.html?ig=https://www.instagram.com/p/YOUR_POST/
```

| Symptom | Cause |
|---|---|
| Page does not load at all | Server is not running. Open Termux, `cd ~/insta-pinmap && ./start-termux.sh` |
| "Port 8080 is in use" | Already running. Otherwise: `node server.js --port 8081` |
| Map stays grey | No internet, or the tile servers do not respond |
| Instagram text missing | See below; this is expected and no big deal |
| Dead after phone restart | Termux:Boot missing or battery saving kicks in (steps 6 and 7) |
| No place matches | Photon and Nominatim do not respond. If need be, enter a LocationIQ key under Settings (5,000 requests/day free) |

### Trying it out without internet

```bash
node server.js --mock
```

Delivers made-up Instagram and place data. The shortcode in the link determines
which case is played back, so you can click through all four situations without
using up real posts:

| Example link | Case played back |
|---|---|
| `…/p/SOLO1/` | Caption consists only of a place name and an emoji |
| `…/p/LANG1/` | long text with the place in the middle of a sentence |
| `…/p/NOPLACE1/` | text without any place |
| `…/p/KAPUTT1/` | fetch fails; shows the fallback with an embedded post |
| anything else | detailed caption with a 📍 marker |

---

## What will break at some point, and what happens then

The Instagram fetch depends on an **unofficial** page
(`instagram.com/p/…/embed/captioned/`) that Meta can change at any time and has
changed several times in the past. There is no official way: Instagram's API
only returns data from accounts that have explicitly authorized your app, and
**Instagram no longer hands out a post's location tag at all**, neither with
nor without login. That is why the place is derived from the text anyway.

The server tries three parsing strategies one after another. If all of them
fail, the app says so openly and shows you the post in an embedded frame right
next to the input field: you read off the place and type it in. **Everything
else keeps working unchanged.** The app becomes less convenient, not broken.

Place search runs via Photon and Nominatim, both community services without any
guarantee. The server sticks to their terms: an identifying user agent, at most
one request per second to Nominatim, no search-as-you-type against Nominatim.
Please do not tinker with that; it is the reason these services stay free.

Map tiles come from OpenStreetMap, with the required attribution and without
caching.

---

## Project structure

```
insta-pinmap/
├── server.js              mini server, no dependencies
├── start-windows.cmd      start on Windows
├── start.sh               start on Linux/WSL/macOS
├── start-termux.sh        start on Android
├── stop-termux.sh
├── HANDOFF.md             handoff for developers: decisions, pitfalls
├── THIRD-PARTY.md         licenses of the bundled libraries
├── data/
│   ├── pins.json          your data (not in the repo)
│   ├── pins.example.json  made-up places for trying things out
│   └── backups/           the last 20 versions
└── web/
    ├── index.html
    ├── selftest.html      diagnostics
    ├── css/app.css
    ├── js/
    │   ├── app.js         wiring
    │   ├── store.js       data storage
    │   ├── map.js         Leaflet
    │   ├── ui.js          list, details, import, backup
    │   ├── addflow.js     link → place → confirmation → pin
    │   ├── extract.js     place candidates from the text
    │   ├── dedupe.js      links, distances, proximity
    │   └── importers.js   Apple, Google, KML, GPX
    └── vendor/            Leaflet, MarkerCluster, fflate, togeojson
```

Everything under `js/` is plain JavaScript with modules: no build step, no
`npm install`, no toolchain. You can open any file, change it and reload the
page.

### Where you are most likely to tinker yourself

- **`extract.js`, `HASHTAG_STOPP`**: hashtags that are never a place. If you
  keep getting the same nonsensical suggestion, add it here.
- **`extract.js`, `WORT_STOPP`**: words that do not count as a place name. In
  German every noun is capitalized, which is why this list is needed. Careful:
  real cities such as Essen, Bergen, Halle or Hamm must not end up here, or they
  disappear.
- **`extract.js`, `MARKER`**: the patterns for explicit place markers, weighted
  by how likely they are to hit.
- **`extract.js`, rule 4 "Restsatz" (remainder)**: kicks in when the caption
  consists of little more than the place name. The thresholds there (at most 70
  characters, at most five words, at least half of them capitalized) decide how
  bold the automatic detection is.
- **`map.js`, `KACHELN`**: more map styles.
- The **proximity threshold** and map style can be changed in the settings
  without touching the code.

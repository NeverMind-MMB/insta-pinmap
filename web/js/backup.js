/**
 * backup.js — one HTML file that is both a read-only map and a full backup.
 *
 * The complete collection sits in <script type="application/json" id="opin-backup">.
 * Opening the file shows the map (Leaflet is embedded); loading it in the app
 * restores the pins.
 */

export const BACKUP_SCRIPT_ID = 'opin-backup';
/** The id in backups made before 1.0.0, which still load. */
const OLDER_SCRIPT_ID = 'pinmap-backup';
const NOT_A_BACKUP = "This file isn't a backup.";
const DAY_MS = 86400000;

/** JSON that is safe inside a <script> element (no </script>, no line separators). */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Only plain hex colours get into markup. */
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c)) ? String(c) : '#8a8f98');

/** The backup file's name: opin-backup-<YYYY-MM-DD>.html. */
export function backupFileName(now = new Date()) {
  return `opin-backup-${now.toISOString().slice(0, 10)}.html`;
}

export function buildBackupHtml(db, { leafletJs, leafletCss, colorOf, now = new Date() }) {
  const pins = db.pins.map((p) => ({
    t: p.title, a: p.address, la: p.lat, lo: p.lon,
    n: p.note, w: p.when || '', g: p.tags || [],
    f: safeColor(colorOf(p)),
    u: (p.posts || []).map((x) => x.url),
  }));
  // Leaflet's default images are not embedded — markers are drawn with CSS.
  const css = leafletCss.replace(/url\((["']?)images\/[^)]+\1\)/g, 'none');
  const date = now.toISOString().slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>oPin backup ${date}</title>
<style>${css}
html,body{margin:0;height:100%;font:16px/1.5 system-ui,sans-serif;background:#16181c;color:#e9e6e1}
#k{position:absolute;inset:0}
.pinmark{width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.4)}
.leaflet-popup-content{font:14px/1.45 system-ui,sans-serif}
.leaflet-popup-content h3{margin:0 0 4px;font-size:15px}
.leaflet-popup-content p{margin:0 0 4px;color:#555}
.leaflet-popup-content .g{display:inline-block;font-size:11px;background:#eee;border-radius:99px;padding:1px 7px;margin:2px 3px 0 0}
#i{position:absolute;z-index:600;left:54px;top:10px;right:10px;background:rgba(22,24,28,.9);padding:8px 12px;border-radius:10px;font-size:13px}
</style></head><body>
<div id="k"></div><div id="i">${pins.length} places · backup of ${date} · read-only. To restore: oPin → Settings → Load backup.</div>
<script type="application/json" id="${BACKUP_SCRIPT_ID}">${jsonForScript(db)}</script>
<script>${leafletJs}<\/script>
<script>
var P=${jsonForScript(pins)};
var m=L.map('k').setView([51,10],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(m);
var b=[];
P.forEach(function(p){
  b.push([p.la,p.lo]);
  var ic=L.divIcon({className:'',html:'<div class="pinmark" style="background:'+p.f+'"></div>',iconSize:[24,24],iconAnchor:[12,24],popupAnchor:[0,-22]});
  var h='<h3>'+esc(p.t)+'</h3>';
  if(p.a)h+='<p>'+esc(p.a)+'</p>';
  if(p.n)h+='<p>'+esc(p.n)+'</p>';
  if(p.w)h+='<p>📅 '+esc(p.w)+'</p>';
  p.g.forEach(function(g){h+='<span class="g">'+esc(g)+'</span>'});
  p.u.forEach(function(u){if(/^https?:[/][/]/i.test(u))h+='<div><a href="'+esc(u)+'" target="_blank" rel="noopener">View post</a></div>'});
  L.marker([p.la,p.lo],{icon:ic}).addTo(m).bindPopup(h);
});
if(b.length)m.fitBounds(b,{padding:[40,40],maxZoom:14});
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
<\/script></body></html>`;
}

/** Reads a backup: the HTML file from buildBackupHtml or a JSON file (also from the old app). */
export function readBackupText(text) {
  const s = String(text || '');
  let data;
  try {
    if (/^\s*</.test(s)) {
      const m = s.match(new RegExp(`<script type="application/json" id="(?:${BACKUP_SCRIPT_ID}|${OLDER_SCRIPT_ID})">([\\s\\S]*?)</script>`));
      if (!m) throw new Error(NOT_A_BACKUP);
      data = JSON.parse(m[1]);
    } else {
      data = JSON.parse(s);
    }
  } catch {
    throw new Error(NOT_A_BACKUP);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.pins)) throw new Error(NOT_A_BACKUP);
  return data;
}

function daysSince(iso, now) {
  return Math.floor((now.getTime() - Date.parse(iso)) / DAY_MS);
}

export function backupAgeText(lastBackupAt, now = new Date()) {
  if (!lastBackupAt || !Number.isFinite(Date.parse(lastBackupAt))) return 'Never';
  const d = daysSince(lastBackupAt, now);
  if (d <= 0) return 'Today';
  return d === 1 ? '1 day ago' : `${d} days ago`;
}

export function needsBackupReminder(lastBackupAt, pinCount, now = new Date()) {
  if (!pinCount) return false;
  if (!lastBackupAt || !Number.isFinite(Date.parse(lastBackupAt))) return true;
  return daysSince(lastBackupAt, now) >= 30;
}

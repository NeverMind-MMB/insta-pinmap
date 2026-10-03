/**
 * ui.js — list view, tag filter, pin details, settings, import, notifications.
 */

import { store, normTag } from './store.js';
import { embedLink, entfernung, entfernungText, shortcode } from './dedupe.js';

const $ = (id) => document.getElementById(id);

/* ================================================================== *
 * Notifications
 * ================================================================== */

let toastTimer = null;

export function toast(text, art = 'info', dauer = 3200) {
  const el = $('toast');
  el.textContent = text;
  el.dataset.art = art;
  el.classList.add('is-an');
  clearTimeout(toastTimer);
  if (dauer > 0) toastTimer = setTimeout(() => el.classList.remove('is-an'), dauer);
}

export function toastWeg() {
  clearTimeout(toastTimer);
  $('toast').classList.remove('is-an');
}

/* ================================================================== *
 * Filter state
 * ================================================================== */

export const filter = {
  tags: new Set(),
  suche: '',
  sortierung: 'neu',
  standort: null,     // { lat, lon } if known
};

export function gefilterte() {
  const q = filter.suche.trim().toLowerCase();
  let pins = store.db.pins;

  if (filter.tags.size) {
    pins = pins.filter((p) => (p.tags || []).some((t) => filter.tags.has(t)));
  }

  if (q) {
    pins = pins.filter((p) => {
      const heu = [
        p.title, p.address, p.note,
        ...(p.tags || []),
        ...(p.posts || []).map((x) => `${x.caption} ${x.username}`),
      ].join(' ').toLowerCase();
      return q.split(/\s+/).every((wort) => heu.includes(wort));
    });
  }

  const s = [...pins];
  switch (filter.sortierung) {
    case 'alt':   s.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); break;
    case 'titel': s.sort((a, b) => a.title.localeCompare(b.title, 'de')); break;
    case 'nah':
      if (filter.standort) {
        const { lat, lon } = filter.standort;
        s.sort((a, b) => entfernung(lat, lon, a.lat, a.lon) - entfernung(lat, lon, b.lat, b.lon));
      }
      break;
    default:      s.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  return s;
}

/* ================================================================== *
 * Tag filter bar
 * ================================================================== */

export function zeichneTagbar(beiAenderung) {
  const bar = $('tagbar');
  const liste = $('tagbar-list');
  const tags = store.alleTags();

  bar.hidden = tags.length === 0;
  liste.innerHTML = '';

  if (!tags.length) return;

  // "All" to reset
  const alleLi = document.createElement('li');
  const alleBtn = document.createElement('button');
  alleBtn.type = 'button';
  alleBtn.className = 'tagchip';
  alleBtn.setAttribute('aria-pressed', String(filter.tags.size === 0));
  alleBtn.innerHTML = `<span>All</span> <span class="tagchip__zahl">${store.db.pins.length}</span>`;
  alleBtn.addEventListener('click', () => { filter.tags.clear(); beiAenderung(); });
  alleLi.appendChild(alleBtn);
  liste.appendChild(alleLi);

  for (const t of tags) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tagchip';
    btn.setAttribute('aria-pressed', String(filter.tags.has(t.name)));
    const punkt = document.createElement('span');
    punkt.className = 'tagchip__punkt';
    punkt.style.background = t.farbe;
    const name = document.createElement('span');
    name.textContent = t.name;
    const zahl = document.createElement('span');
    zahl.className = 'tagchip__zahl';
    zahl.textContent = String(t.anzahl);
    btn.append(punkt, name, zahl);
    btn.addEventListener('click', () => {
      if (filter.tags.has(t.name)) filter.tags.delete(t.name);
      else filter.tags.add(t.name);
      beiAenderung();
    });
    li.appendChild(btn);
    liste.appendChild(li);
  }
}

/* ================================================================== *
 * List view
 * ================================================================== */

export function zeichneListe(pins, beiKlick) {
  const ol = $('liste');
  const zaehler = $('liste-zaehler');
  ol.innerHTML = '';

  const gesamt = store.db.pins.length;
  zaehler.textContent = gesamt === 0
    ? ''
    : pins.length === gesamt
      ? `${gesamt} ${gesamt === 1 ? 'place' : 'places'}`
      : `${pins.length} of ${gesamt} places`;

  if (!pins.length) {
    const li = document.createElement('li');
    li.className = 'liste__leer';
    li.textContent = gesamt === 0
      ? 'Nothing saved yet. Paste an Instagram link below.'
      : 'No place matches this filter.';
    ol.appendChild(li);
    return;
  }

  for (const pin of pins) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eintrag';

    const punkt = document.createElement('span');
    punkt.className = 'eintrag__punkt';
    punkt.style.background = store.pinFarbe(pin);

    const titel = document.createElement('p');
    titel.className = 'eintrag__titel';
    titel.textContent = pin.title;

    const meta = document.createElement('p');
    meta.className = 'eintrag__meta';
    const anzahl = (pin.posts || []).length;
    meta.textContent = [
      pin.address || `${pin.lat.toFixed(4)}, ${pin.lon.toFixed(4)}`,
      anzahl > 1 ? `${anzahl} posts` : null,
    ].filter(Boolean).join(' · ');

    const rechts = document.createElement('span');
    rechts.className = 'eintrag__rechts';
    const st = document.createElement('span');
    st.className = 'eintrag__status';
    st.dataset.status = pin.status;
    st.textContent = pin.status === 'visited' ? 'been there' : 'want to go';
    rechts.appendChild(st);
    if (filter.sortierung === 'nah' && filter.standort) {
      const d = document.createElement('span');
      d.textContent = entfernungText(entfernung(filter.standort.lat, filter.standort.lon, pin.lat, pin.lon));
      rechts.appendChild(d);
    }

    btn.append(punkt, titel, meta, rechts);

    if ((pin.tags || []).length) {
      const tagUl = document.createElement('ul');
      tagUl.className = 'eintrag__tags';
      for (const t of pin.tags) {
        const tli = document.createElement('li');
        tli.className = 'eintrag__tag';
        tli.textContent = t;
        tagUl.appendChild(tli);
      }
      btn.appendChild(tagUl);
    }

    btn.addEventListener('click', () => beiKlick(pin.id));
    li.appendChild(btn);
    ol.appendChild(li);
  }
}

/* ================================================================== *
 * Pin details
 * ================================================================== */

let detailPinId = null;

export function zeigeDetail(pinId, umgebung) {
  const pin = store.pin(pinId);
  if (!pin) return;
  detailPinId = pinId;

  const dlg = $('dlg-detail');
  const body = $('detail-body');
  $('dlg-detail-titel').textContent = pin.title;
  body.innerHTML = '';

  // --- Title ---
  body.appendChild(feld('Title', () => {
    const i = document.createElement('input');
    i.type = 'text';
    i.id = 'detail-titel';
    i.value = pin.title;
    return i;
  }));

  // --- Address and coordinates ---
  const adr = document.createElement('div');
  adr.className = 'feld';
  const a1 = document.createElement('p');
  a1.className = 'detail__adresse';
  a1.textContent = pin.address || '(no address stored)';
  const a2 = document.createElement('p');
  a2.className = 'detail__koord';
  a2.textContent = `${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`;
  const reihe = document.createElement('div');
  reihe.className = 'knopfreihe';
  reihe.append(
    linkKnopf('Open in OpenStreetMap', `https://www.openstreetmap.org/?mlat=${pin.lat}&mlon=${pin.lon}#map=17/${pin.lat}/${pin.lon}`),
    linkKnopf('Directions (Google)', `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lon}`),
  );
  adr.append(a1, a2, reihe);
  body.appendChild(adr);

  // --- Status ---
  const stFeld = document.createElement('div');
  stFeld.className = 'feld';
  const stLab = document.createElement('span');
  stLab.className = 'feld__label';
  stLab.textContent = 'Status';
  const stGrp = document.createElement('div');
  stGrp.className = 'segmented segmented--voll';
  stGrp.setAttribute('role', 'radiogroup');
  stGrp.setAttribute('aria-label', 'Status');
  for (const [wert, text] of [['wishlist', 'Want to go'], ['visited', 'Been there']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.className = 'segmented__btn' + (pin.status === wert ? ' is-active' : '');
    b.setAttribute('aria-checked', String(pin.status === wert));
    b.dataset.status = wert;
    b.textContent = text;
    b.addEventListener('click', () => {
      for (const x of stGrp.children) {
        const an = x === b;
        x.classList.toggle('is-active', an);
        x.setAttribute('aria-checked', String(an));
      }
    });
    stGrp.appendChild(b);
  }
  stFeld.append(stLab, stGrp);
  body.appendChild(stFeld);

  // --- Note ---
  body.appendChild(feld('Note', () => {
    const t = document.createElement('textarea');
    t.id = 'detail-notiz';
    t.rows = 3;
    t.value = pin.note || '';
    return t;
  }));

  // --- Tags ---
  const tagFeld = document.createElement('div');
  tagFeld.className = 'feld';
  const tagLab = document.createElement('span');
  tagLab.className = 'feld__label';
  tagLab.textContent = 'Tags';
  const tagUl = document.createElement('ul');
  tagUl.className = 'chips';
  let tags = [...(pin.tags || [])];

  const zeichneChips = () => {
    tagUl.innerHTML = '';
    for (const t of tags) {
      const li = document.createElement('li');
      li.className = 'chip';
      li.style.borderColor = store.tagFarbe(t);
      const s = document.createElement('span');
      s.textContent = t;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip__x';
      x.setAttribute('aria-label', `Remove tag ${t}`);
      x.textContent = '×';
      x.addEventListener('click', () => { tags = tags.filter((a) => a !== t); zeichneChips(); });
      li.append(s, x);
      tagUl.appendChild(li);
    }
  };
  zeichneChips();

  const tagEin = document.createElement('div');
  tagEin.className = 'tageingabe';
  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = 'Add tag …';
  tagInput.setAttribute('list', 'tag-vorschlagsliste');
  const tagBtn = document.createElement('button');
  tagBtn.type = 'button';
  tagBtn.className = 'btn btn--klein';
  tagBtn.textContent = '+';
  const tagAdd = () => {
    const t = normTag(tagInput.value);
    if (t && !tags.includes(t)) tags.push(t);
    tagInput.value = '';
    zeichneChips();
  };
  tagBtn.addEventListener('click', tagAdd);
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); tagAdd(); }
  });
  tagEin.append(tagInput, tagBtn);
  tagFeld.append(tagLab, tagUl, tagEin);
  body.appendChild(tagFeld);

  // --- Posts ---
  if ((pin.posts || []).length) {
    const h = document.createElement('p');
    h.className = 'feld__label';
    h.textContent = pin.posts.length === 1 ? '1 post at this place' : `${pin.posts.length} posts at this place`;
    body.appendChild(h);

    const ul = document.createElement('ul');
    ul.className = 'detail__posts';
    for (const post of pin.posts) {
      const li = document.createElement('li');
      li.className = 'detail__post';

      const eb = embedLink(post.url);
      if (eb) {
        const f = document.createElement('iframe');
        f.src = eb;
        f.loading = 'lazy';
        f.title = `Instagram post by ${post.username || 'unknown'}`;
        f.referrerPolicy = 'no-referrer';
        f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
        li.appendChild(f);
      }

      const foot = document.createElement('div');
      foot.className = 'detail__postfoot';
      const a = document.createElement('a');
      a.href = post.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = post.username ? `@${post.username}` : 'Open on Instagram';
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--klein btn--gefahr';
      del.textContent = 'Remove post';
      del.addEventListener('click', () => {
        store.postLoeschen(pin.id, post.url);
        umgebung.neuZeichnen();
        zeigeDetail(pin.id, umgebung);
      });
      foot.append(a, del);
      li.appendChild(foot);
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  // --- Footer buttons ---
  $('detail-speichern').onclick = () => {
    const aktiv = stGrp.querySelector('[aria-checked="true"]');
    store.pinAendern(pin.id, {
      title: $('detail-titel').value.trim() || pin.title,
      note: $('detail-notiz').value.trim(),
      status: aktiv?.dataset.status || pin.status,
      tags,
    });
    dlg.close();
    umgebung.neuZeichnen();
    toast('Saved.', 'gut');
  };

  $('detail-loeschen').onclick = () => {
    // No window.confirm: it blocks and looks bad on a phone.
    const btn = $('detail-loeschen');
    if (btn.dataset.sicher === 'ja') {
      store.pinLoeschen(pin.id);
      dlg.close();
      umgebung.neuZeichnen();
      toast(`"${pin.title}" deleted.`, 'info');
      return;
    }
    btn.dataset.sicher = 'ja';
    btn.textContent = 'Really delete?';
    setTimeout(() => {
      btn.dataset.sicher = '';
      btn.textContent = 'Delete';
    }, 4000);
  };

  dlg.showModal();
}

function feld(label, machElement) {
  const wrap = document.createElement('label');
  wrap.className = 'feld';
  const s = document.createElement('span');
  s.className = 'feld__label';
  s.textContent = label;
  wrap.append(s, machElement());
  return wrap;
}

function linkKnopf(text, href) {
  const a = document.createElement('a');
  a.className = 'btn btn--klein';
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = text;
  return a;
}

/* ================================================================== *
 * Import dialog
 * ================================================================== */

export function zeigeImport(eintraege, quellName, umgebung) {
  const dlg = $('dlg-import');
  const liste = $('import-liste');
  $('dlg-import-titel').textContent = quellName ? `Import: ${quellName}` : 'Places found';

  const mitKoord = eintraege.filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon));
  const ohne = eintraege.length - mitKoord.length;
  $('import-info').textContent =
    `${eintraege.length} ${eintraege.length === 1 ? 'place' : 'places'} found` +
    (ohne ? ` — ${ohne} of them have no coordinates; these will be looked up on import.` : '.');

  liste.innerHTML = '';
  eintraege.forEach((e, i) => {
    const li = document.createElement('li');
    li.className = 'importzeile';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.id = `imp-${i}`;
    cb.dataset.index = String(i);

    const lab = document.createElement('label');
    lab.className = 'importzeile__name';
    lab.htmlFor = cb.id;
    lab.textContent = e.name;

    const adr = document.createElement('span');
    adr.className = 'importzeile__adr';
    adr.textContent = e.address ||
      (Number.isFinite(e.lat) ? `${e.lat.toFixed(4)}, ${e.lon.toFixed(4)}` : '');

    li.append(cb, lab, adr);

    if (e.warnung) {
      const w = document.createElement('span');
      w.className = 'importzeile__warn';
      w.textContent = e.warnung;
      li.appendChild(w);
    }
    liste.appendChild(li);
  });

  const alle = (an) => {
    for (const cb of liste.querySelectorAll('input[type=checkbox]')) cb.checked = an;
  };
  $('import-alle').onclick = () => alle(true);
  $('import-keine').onclick = () => alle(false);

  $('import-uebernehmen').onclick = async () => {
    const gewaehlt = [...liste.querySelectorAll('input[type=checkbox]:checked')]
      .map((cb) => eintraege[Number(cb.dataset.index)]);
    dlg.close();
    await uebernehmeImport(gewaehlt, quellName, umgebung);
  };

  dlg.showModal();
}

async function uebernehmeImport(eintraege, quellName, umgebung) {
  let angelegt = 0;
  let uebersprungen = 0;
  const fehlgeschlagen = [];
  const radius = store.einstellungen.radiusM;

  for (let i = 0; i < eintraege.length; i++) {
    const e = eintraege[i];
    toast(`Importing ${i + 1} of ${eintraege.length} …`, 'info', 0);

    let lat = e.lat;
    let lon = e.lon;

    // Resolve short link
    if (!Number.isFinite(lat) && e.url && /goo\.gl|maps\.apple\/|g\.co/i.test(e.url)) {
      try {
        const j = await (await fetch(`/api/resolve?url=${encodeURIComponent(e.url)}`)).json();
        if (j.ok && j.url) {
          const { googleKoordinaten } = await import('./importers.js');
          const k = googleKoordinaten(j.url);
          if (k) { lat = k.lat; lon = k.lon; }
        }
      } catch { /* next attempt: search by name */ }
    }

    // Search by name
    if (!Number.isFinite(lat)) {
      try {
        const q = [e.name, e.address].filter(Boolean).join(', ');
        const j = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}&limit=1`)).json();
        const t = (j.results || [])[0];
        if (t) { lat = t.lat; lon = t.lon; if (!e.address) e.address = t.address; }
      } catch { /* give up */ }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      fehlgeschlagen.push(e.name);
      continue;
    }

    // Is there already something at this spot? During a batch import, don't ask;
    // silently skip very close duplicates instead.
    const nah = store.db.pins.find(
      (p) => entfernung(lat, lon, p.lat, p.lon) < Math.min(radius, 60)
    );
    if (nah) { uebersprungen++; continue; }

    const tags = [];
    if (e.tagVorschlag) { const t = normTag(e.tagVorschlag); if (t) tags.push(t); }

    store.neuerPin({
      lat, lon,
      title: e.name,
      address: e.address || '',
      note: e.note || '',
      tags,
      quelle: e.quelle || 'import',
    });
    angelegt++;
  }

  await store.sichern();
  umgebung.neuZeichnen();
  toastWeg();

  const teile = [`${angelegt} ${angelegt === 1 ? 'place' : 'places'} imported`];
  if (uebersprungen) teile.push(`${uebersprungen} skipped as duplicates`);
  if (fehlgeschlagen.length) teile.push(`${fehlgeschlagen.length} left without coordinates`);
  toast(teile.join(', ') + '.', fehlgeschlagen.length ? 'fehler' : 'gut', 6000);

  if (angelegt) umgebung.karte?.passeAn(store.db.pins);
}

/* ================================================================== *
 * Backup
 * ================================================================== */

function ladeHerunter(name, inhalt, typ) {
  const blob = new Blob([inhalt], { type: typ });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportiereJSON() {
  const datum = new Date().toISOString().slice(0, 10);
  ladeHerunter(`ortsammlung-${datum}.json`, store.alsJSON(), 'application/json');
  toast('Backup downloaded.', 'gut');
}

/**
 * A standalone HTML file with all pins baked in.
 * Opens with a double-click and shows the map, with no server and nothing else.
 * View only; editing still happens in the real app.
 */
export async function exportiereHTML() {
  toast('Building the standalone map …', 'info', 0);
  try {
    const [leafletJs, leafletCss] = await Promise.all([
      fetch('/vendor/leaflet/leaflet.js').then((r) => r.text()),
      fetch('/vendor/leaflet/leaflet.css').then((r) => r.text()),
    ]);

    const pins = store.db.pins.map((p) => ({
      t: p.title, a: p.address, la: p.lat, lo: p.lon,
      s: p.status, n: p.note, g: p.tags || [],
      f: store.pinFarbe(p),
      u: (p.posts || []).map((x) => x.url),
    }));

    // Leaflet's default images are not available here, so use custom CSS pins.
    const css = leafletCss.replace(/url\((["']?)images\/[^)]+\1\)/g, 'none');

    // Embedding JSON in a <script> element is only safe if angle brackets
    // are escaped: otherwise a title like "</script>" would end the element
    // in the middle of the data and swallow half the map.
    const jsonFuerScript = (wert) =>
      JSON.stringify(wert)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ortsammlung — as of ${new Date().toLocaleDateString('de-DE')}</title>
<style>${css}
html,body{margin:0;height:100%;font:16px/1.5 system-ui,sans-serif;background:#16181c;color:#e9e6e1}
#k{position:absolute;inset:0}
.pinmark{width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.4)}
.leaflet-popup-content{font:14px/1.45 system-ui,sans-serif}
.leaflet-popup-content h3{margin:0 0 4px;font-size:15px}
.leaflet-popup-content p{margin:0 0 4px;color:#555}
.leaflet-popup-content .g{display:inline-block;font-size:11px;background:#eee;border-radius:99px;padding:1px 7px;margin:2px 3px 0 0}
#i{position:absolute;z-index:600;left:10px;top:10px;background:rgba(22,24,28,.9);padding:8px 12px;border-radius:10px;font-size:13px}
</style></head><body>
<div id="k"></div><div id="i">${pins.length} places · as of ${new Date().toLocaleDateString('de-DE')} · view only</div>
<script>${leafletJs}<\/script>
<script>
var P=${jsonFuerScript(pins)};
var m=L.map('k').setView([51,10],5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(m);
var b=[];
P.forEach(function(p){
  b.push([p.la,p.lo]);
  var ic=L.divIcon({className:'',html:'<div class="pinmark" style="background:'+p.f+'"></div>',iconSize:[24,24],iconAnchor:[12,24],popupAnchor:[0,-22]});
  var h='<h3>'+esc(p.t)+'</h3>';
  if(p.a)h+='<p>'+esc(p.a)+'</p>';
  if(p.n)h+='<p>'+esc(p.n)+'</p>';
  h+='<p>'+(p.s==='visited'?'been there':'want to go')+'</p>';
  p.g.forEach(function(g){h+='<span class="g">'+esc(g)+'</span>'});
  p.u.forEach(function(u){h+='<div><a href="'+esc(u)+'" target="_blank" rel="noopener">View post</a></div>'});
  L.marker([p.la,p.lo],{icon:ic}).addTo(m).bindPopup(h);
});
if(b.length)m.fitBounds(b,{padding:[40,40],maxZoom:14});
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
<\/script></body></html>`;

    const datum = new Date().toISOString().slice(0, 10);
    ladeHerunter(`ortskarte-${datum}.html`, html, 'text/html');
    toast('Standalone map downloaded. Open it with a double-click.', 'gut', 5000);
  } catch (e) {
    toast('Could not build the map: ' + e.message, 'fehler');
  }
}

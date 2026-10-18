/**
 * guidehelper.js — the oPin guide helper: Apple Guides without an iPhone.
 *
 * A bookmarklet for a computer's browser (Chrome, Edge, Firefox) that does on an
 * Apple Maps guide page what the iPhone Shortcut's Safari script does: it reads
 * the guide's data the page already has (`shell-props`), takes the places it
 * names with their position, fetches every other Apple Maps place same-origin
 * from /place?auid=<id> (each page only up to `</head>`), and copies the guide
 * link plus one "@@" line per place, which oPin's input bar (or "Paste results")
 * reads like the Shortcut's output. Unlike the Shortcut it has no time limit,
 * so it waits for every place and shows how far it is.
 *
 * The app only hands the helper out (a link to drag to the bookmarks bar, or
 * its code to paste as a bookmark's address); it never runs it itself.
 */

/**
 * The helper itself. It runs on maps.apple.com, not in the app: no imports, block comments
 * only (a bookmark's address may lose its line breaks), every statement ends with ";", texts
 * go in with textContent. Returns the promise of its work (the bookmarklet drops it).
 */
export function guideHelper() {
  var ID = 'opin-guide-helper';
  var old = document.getElementById(ID);
  if (old) old.remove();
  var box = document.createElement('div');
  box.id = ID;
  box.setAttribute('style', 'position:fixed;left:12px;right:12px;top:12px;z-index:2147483647;max-width:460px;margin:0 auto;' +
    'background:#fff;color:#111;border:2px solid #111;border-radius:12px;padding:14px 16px;font:16px/1.4 system-ui,sans-serif;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.3)');
  var line = document.createElement('div');
  box.appendChild(line);
  document.body.appendChild(box);
  var say = function (text) { line.textContent = 'oPin: ' + text; };
  var button = function (label, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('style', 'margin:10px 8px 0 0;padding:8px 14px;font:600 15px system-ui,sans-serif;border-radius:8px;border:0;background:#111;color:#fff;cursor:pointer');
    b.addEventListener('click', onClick);
    box.appendChild(b);
    return b;
  };
  var closeButton = function () { button('Close', function () { box.remove(); }); };
  var dec = function (s) {
    return s.replace(/&(amp|quot|#39|#x27|lt|gt);/g, function (m, e) {
      return { amp: '&', quot: '"', '#39': "'", '#x27': "'", lt: '<', gt: '>' }[e];
    });
  };
  var meta = function (html, key) {
    var m = html.match(new RegExp('<meta[^>]*(?:property|name)="' + key + '"[^>]*>', 'i'));
    var c = m && m[0].match(/content="([^"]*)"/i);
    return c ? dec(c[1]) : '';
  };
  var row = function (id, name, lat, lon, address) {
    return ['https://maps.apple.com/place?auid=' + id, name, lat, lon, address || ''].join('@@');
  };
  /* A place page up to </head> (about 4 KB of 40 KB); the download stops there. */
  var head = async function (id) {
    var res = await fetch('/place?auid=' + id);
    if (!res.ok || !res.body) return '';
    var reader = res.body.getReader();
    var td = new TextDecoder();
    var s = '';
    for (;;) {
      var part = await reader.read();
      if (part.done) break;
      s += td.decode(part.value, { stream: true });
      var end = s.search(/<\/head>/i);
      if (end !== -1) {
        reader.cancel().catch(function () {});
        return s.slice(0, end);
      }
      if (s.length > 65536) break;
    }
    reader.cancel().catch(function () {});
    return s;
  };
  var copy = async function (text, what) {
    try {
      await navigator.clipboard.writeText(text);
      say('Copied ' + what + ' — paste in oPin.');
      closeButton();
    } catch (e) {
      /* The browser wants a fresh click for the clipboard after the long wait. */
      say(what + ' ready.');
      var b = button('Copy', async function () {
        try {
          await navigator.clipboard.writeText(text);
          say('Copied ' + what + ' — paste in oPin.');
          b.remove();
        } catch (x) {
          var area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('style', 'display:block;width:100%;height:120px;margin-top:10px;font:12px monospace');
          box.appendChild(area);
          area.select();
          say('Copy the text in the box, then paste it in oPin.');
        }
      });
      closeButton();
    }
  };
  return (async function () {
    try {
      if (!/(^|\.)maps\.apple\.com$/i.test(location.hostname)) {
        say('open the guide on maps.apple.com first, then click the helper there.');
        closeButton();
        return;
      }
      say('reading the guide …');
      var el = document.getElementById('shell-props');
      var raw = el ? el.textContent : await (await fetch(location.href)).text();
      var ids = Array.from(new Set(Array.from(raw.matchAll(/"ref":"(\d+)","muid"/g), function (m) { return m[1]; })));
      if (!ids.length) {
        say('this page lists no Apple Maps places. Open the guide itself (maps.apple.com/guides?…).');
        closeButton();
        return;
      }
      var lines = [];
      var done = new Set();
      /* The first places come with name and position on the page itself. */
      for (var m of raw.matchAll(/\{"ref":"(\d+)","title":("(?:[^"\\]|\\.)*"),"center":\[(-?[\d.]+),(-?[\d.]+)\]/g)) {
        if (done.has(m[1])) continue;
        done.add(m[1]);
        lines.push(row(m[1], JSON.parse(m[2]), m[3], m[4], ''));
      }
      var rest = ids.filter(function (id) { return !done.has(id); });
      var next = 0;
      var finished = 0;
      var progress = function () { say('fetching places ' + finished + ' of ' + rest.length + ' …'); };
      if (rest.length) progress();
      var one = async function (id) {
        try {
          var h = await head(id);
          var name = meta(h, 'og:title');
          var lat = meta(h, 'place:location:latitude');
          var lon = meta(h, 'place:location:longitude');
          if (!name || !lat || !lon) return;
          var title = dec((h.match(/<title[^>]*>([^<]*)</i) || [])[1] || '').replace(/\s+\S\s+Apple\s(Maps|Karten)\s*$/, '');
          lines.push(row(id, name, lat, lon, title.indexOf(name + ' in ') === 0 ? title.slice(name.length + 4) : ''));
        } catch (e) { /* one place failed: the others go on */ }
      };
      /* Four at a time, so Apple isn't asked for everything at once. */
      var worker = async function () {
        while (next < rest.length) {
          var id = rest[next];
          next += 1;
          await one(id);
          finished += 1;
          progress();
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      /* The guide link first: oPin reads the guide's name and own pins from it. */
      await copy([location.href].concat(lines).join('\n'), lines.length + ' of ' + ids.length + ' places');
    } catch (e) {
      say('something went wrong: ' + e);
      closeButton();
    }
  })();
}

/** The helper as a bookmark's address: javascript:void(…), so the page stays as it is. */
export function guideHelperCode() {
  return `javascript:${encodeURIComponent(`void (${guideHelper.toString()})();`)}`;
}

const HOW_TO_ADD = 'Drag "oPin guide helper" to your bookmarks bar (or make a bookmark and paste the helper code as its address). ' +
  'Then open the guide on maps.apple.com and click the bookmark there.';

/**
 * Points the guide helper links (import dialog, Settings) at the helper and wires the
 * "Copy helper code" buttons. A click on the link in the app never runs it: it says how to
 * add it as a bookmark instead.
 * @param {{querySelectorAll: Function}} root
 * @param {(text: string, kind?: string, ms?: number) => void} toast
 */
export function linkGuideHelper(root, toast) {
  const code = guideHelperCode();
  for (const a of root.querySelectorAll('a[data-guide-helper]')) {
    a.href = code;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      toast(HOW_TO_ADD, 'info', 10000);
    });
  }
  for (const b of root.querySelectorAll('button[data-guide-helper-copy]')) {
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code);
        toast('Helper code copied. Make a new bookmark and paste it as its address (URL).', 'success', 8000);
      } catch {
        toast('Your browser blocked copying. Drag "oPin guide helper" to your bookmarks bar instead.', 'info', 8000);
      }
    });
  }
}

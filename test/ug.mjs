// test/ug.mjs — a tiny protobuf writer for synthetic Apple Guide links (no real guide data in tests).

function pbVarint(n) {
  let v = BigInt(n);
  const out = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}
const pbKey = (number, type) => pbVarint((number << 3) | type);
export const pbBytes = (number, bytes) => [...pbKey(number, 2), ...pbVarint(bytes.length), ...bytes];
export const pbText = (number, s) => pbBytes(number, [...new TextEncoder().encode(s)]);
function pbDouble(number, x) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, x, true);
  return [...pbKey(number, 1), ...b];
}

/** An f2 entry naming a place only by its Apple ID; kind 9902 = POI, 6489 = region. */
export const pbIdRef = (kind, id) => pbBytes(2, [...pbKey(1, 0), ...pbVarint(kind), ...pbKey(2, 0), ...pbVarint(id)]);

/** An f2 entry with everything inline (custom pin). */
export const pbPin = (name, address, lat, lon) =>
  pbBytes(2, [...pbText(3, address), ...pbBytes(4, [...pbDouble(1, lat), ...pbDouble(2, lon)]), ...pbText(5, name)]);

/** guides.apple.com link from the guide's fields (title first: pbText(1, title)). */
export function ugLink(parts) {
  const b64 = btoa(String.fromCharCode(...parts.flat()));
  return `https://guides.apple.com/?ug=${encodeURIComponent(b64)}`;
}

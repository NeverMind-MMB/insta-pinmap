#!/usr/bin/env node
/**
 * apple-guide.mjs — turns an Apple Guide link into a GeoJSON file for Insta Pinmap.
 *
 *   node tools/apple-guide.mjs "<guide link>" [out.geojson]
 *
 * Apple Guides name the places Apple Maps knows only by an ID. This script asks
 * maps.apple.com for each of them from your own computer (one request per
 * second) and writes all places of the guide to a GeoJSON file. Load that file
 * in the app: Settings → Import → Choose files.
 *
 * Node 24, no dependencies.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readAppleGuide, appleIdLink } from '../web/js/importers.js';
import { parseApplePlaceHtml } from '../web/js/appleplace.js';

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAUSE_MS = 1000;
const APPLE_HOST = 'maps.apple.com';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function feature({ name, address, lat, lon }) {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { name, address: address || '', source: 'apple-guide' },
  };
}

/** One place; null when Apple doesn't answer with a readable place page. Never throws. */
async function lookUp(id, fetchFn) {
  try {
    const res = await fetchFn(appleIdLink(id), {
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.8' },
    });
    // Only a 200 that ended on maps.apple.com itself is read.
    if (res.status !== 200 || new URL(res.url).hostname.toLowerCase() !== APPLE_HOST) return null;
    return parseApplePlaceHtml(await res.text());
  } catch {
    return null;
  }
}

/**
 * Reads the guide and looks up its Apple Maps places one after the other.
 * @returns {Promise<{title, total, found, unresolved: string[], geojson}>}
 *   total/found count the Apple Maps places; geojson holds inline and found places in guide order.
 */
export async function guideToGeoJSON(link, { fetch: fetchFn = globalThis.fetch, sleep = wait, onPlace = () => {} } = {}) {
  const { title, entries, appleIds } = readAppleGuide(link);
  const features = entries.map(feature);
  const unresolved = [];
  for (let i = 0; i < appleIds.length; i++) {
    if (i > 0) await sleep(PAUSE_MS);
    const id = appleIds[i];
    const place = await lookUp(id, fetchFn);
    if (place) features.push(feature(place));
    else unresolved.push(id);
    onPlace(id, place, i + 1, appleIds.length);
  }
  return {
    title,
    total: appleIds.length,
    found: appleIds.length - unresolved.length,
    unresolved,
    geojson: { type: 'FeatureCollection', features },
  };
}

/** Names Windows keeps for devices, whatever the extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** "<guide title>.geojson", without characters or names a file system refuses. */
export function outputName(title) {
  const base = String(title || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  if (!base) return 'apple-guide.geojson';
  return `${WINDOWS_RESERVED.test(base) ? '_' : ''}${base}.geojson`;
}

async function main(args) {
  const [link, out] = args;
  if (!link) {
    console.error('Usage: node tools/apple-guide.mjs "<guide link>" [out.geojson]');
    process.exitCode = 2;
    return;
  }
  let result;
  try {
    result = await guideToGeoJSON(link, {
      onPlace: (id, place, n, total) => console.log(`${n}/${total} ${place ? place.name : `not found (${id})`}`),
    });
  } catch (e) {
    console.error(`Couldn't read the guide link: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  const file = resolve(out || outputName(result.title));
  writeFileSync(file, JSON.stringify(result.geojson, null, 2) + '\n', 'utf8');
  console.log(`Found ${result.found} of ${result.total} Apple Maps places.`);
  if (result.unresolved.length) {
    console.log('Not found:');
    for (const id of result.unresolved) console.log(`  ${id}  ${appleIdLink(id)}`);
  }
  console.log(`${result.geojson.features.length} places written to ${file}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}

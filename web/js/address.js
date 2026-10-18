/**
 * address.js — oPin moved from insta-pinmap.<subdomain>.workers.dev to
 * opin.<subdomain>.workers.dev. Pins live per address, so the old address
 * shows a banner that walks people over (save a backup, open the new address,
 * load the backup there). The subdomain is never hard-coded.
 */

import { MOVED_TO_OPIN } from './sources.js';

/** The first host label of the old address. */
const OLD_LABEL = 'insta-pinmap';
/** The first host label of the new address. */
const NEW_LABEL = 'opin';

/** True when the app runs at the old address: a host whose first label is "insta-pinmap". */
export function isOldAddress(hostname) {
  return String(hostname || '').split('.')[0] === OLD_LABEL;
}

/** Whether the move banner shows here: at the old address, unless this copy didn't move (MOVED_TO_OPIN). */
export function showsMoveBanner(hostname, moved = MOVED_TO_OPIN) {
  return moved === true && isOldAddress(hostname);
}

/** The same URL at the new address: the host's first label replaced by "opin". */
export function newAddressUrl(href) {
  const url = new URL(href);
  url.hostname = [NEW_LABEL, ...url.hostname.split('.').slice(1)].join('.');
  return url.href;
}

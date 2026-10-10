import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventDate, formatDay } from '../web/js/extract.js';

// Default context: posted in August 2026, looked at two weeks later.
const CTX = { postedAt: '2026-08-01', today: '2026-08-15' };
const ev = (caption, ctx = {}) => eventDate(caption, { ...CTX, ...ctx });

/** [caption, from, to, text] — all in 2026, single month, not yearly unless stated. */
const POSITIVE = [
  // Numeric (German)
  ['Flohmarkt am 14.09.2026 im Hof', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Wir sind da: 14.9.26 ab 10 Uhr', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Nur am 14.09.!', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Stadtfest 14.–16.09. in der Altstadt', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Stadtfest 14.-16.9.2026', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Herbstmarkt 1.10.26', '2026-10-01', '2026-10-01', '1 Oct 2026'],
  // Day + month name (German)
  ['Kirchweih 14. bis 16. September', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Am 14. September 2026 geht es los', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Am 14. September geht es los', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Weinfest 14.–16. September', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Geöffnet vom 14. bis 16. September', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Tag der offenen Tür am 3. Okt. 🎉', '2026-10-03', '2026-10-03', '3 Oct 2026'],
  ['Saisonstart 15. Mär 2027', '2027-03-15', '2027-03-15', '15 Mar 2027'],
  // English
  ['Grand opening September 14, 2026!', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['See you September 14 at the pier', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Festival Sept 14-16 💃', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Pop-up on 14 Sep only', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Market 14-16 Sep 2026', '2026-09-14', '2026-09-16', '14–16 Sep 2026'],
  ['Join us Sep 14th', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Party on the 14th of September', '2026-09-14', '2026-09-14', '14 Sep 2026'],
  ['Christmas market until December 24th', '2026-12-24', '2026-12-24', '24 Dec 2026'],
  ['Opens May 2', '2026-05-02', '2026-05-02', null], // in the past → yearly (checked below)
];

for (const [caption, from, to, text] of POSITIVE) {
  test(`eventDate finds "${caption}"`, () => {
    const r = ev(caption);
    assert.ok(r, 'expected a date');
    if (text === null) return;
    assert.deepEqual(r, { from, to, monthOnly: false, yearly: false, text });
  });
}

/** [caption, from, to, text] — month only. */
const MONTH_ONLY = [
  ['Wir sehen uns im September', '2026-09-01', '2026-09-30', 'Sep 2026'],
  ['Back in September with a new menu', '2026-09-01', '2026-09-30', 'Sep 2026'],
  ['Coming this September', '2026-09-01', '2026-09-30', 'Sep 2026'],
  ['Opening September 2026', '2026-09-01', '2026-09-30', 'Sep 2026'],
  ['Eröffnung Ende September', '2026-09-01', '2026-09-30', 'Sep 2026'],
  ['Anfang Oktober wieder offen', '2026-10-01', '2026-10-31', 'Oct 2026'],
  ['Wiedereröffnung Februar 2028', '2028-02-01', '2028-02-29', 'Feb 2028'],
];

for (const [caption, from, to, text] of MONTH_ONLY) {
  test(`eventDate month only: "${caption}"`, () => {
    assert.deepEqual(ev(caption), { from, to, monthOnly: true, yearly: false, text });
  });
}

test('eventDate: the year comes from the post date', () => {
  const r = ev('Am 14. September', { postedAt: '2024-08-01', today: '2024-08-20' });
  assert.equal(r.from, '2024-09-14');
  assert.equal(r.yearly, false);
});

test('eventDate: without a post date the year comes from today', () => {
  const r = ev('Am 14. September', { postedAt: '', today: '2026-08-20' });
  assert.equal(r.from, '2026-09-14');
  assert.equal(r.text, '14 Sep 2026');
});

test('eventDate: date already past and no year given → probably yearly, next occurrence', () => {
  const r = ev('14. September', { postedAt: '2025-08-01', today: '2026-10-10' });
  assert.deepEqual(r, { from: '2027-09-14', to: '2027-09-14', monthOnly: false, yearly: true, text: '14 Sep 2027 (probably yearly)' });
  const may = ev('Opens May 2');
  assert.deepEqual(may, { from: '2027-05-02', to: '2027-05-02', monthOnly: false, yearly: true, text: '2 May 2027 (probably yearly)' });
});

test('eventDate: a past range or month rolls forward as a whole', () => {
  assert.deepEqual(ev('Fest 1.-3.8.', { today: '2026-08-15' }),
    { from: '2027-08-01', to: '2027-08-03', monthOnly: false, yearly: true, text: '1–3 Aug 2027 (probably yearly)' });
  assert.deepEqual(ev('Immer im März', { today: '2026-08-15' }),
    { from: '2027-03-01', to: '2027-03-31', monthOnly: true, yearly: true, text: 'Mar 2027 (probably yearly)' });
  assert.equal(ev('Spargelzeit ab 1. Mrz').from, '2027-03-01');
});

test('eventDate: an explicit year in the past stays as it is', () => {
  assert.deepEqual(ev('Damals am 14.09.2019', { today: '2026-10-10' }),
    { from: '2019-09-14', to: '2019-09-14', monthOnly: false, yearly: false, text: '14 Sep 2019' });
  assert.equal(ev('Opening September 2019', { today: '2026-10-10' }).yearly, false);
});

test('eventDate: today itself is not in the past', () => {
  assert.equal(ev('Heute, 15.08.!', { today: '2026-08-15' }).yearly, false);
});

test('eventDate: the first date in the caption wins', () => {
  assert.equal(ev('Am 14.09. und am 21.09.').from, '2026-09-14');
  assert.equal(ev('Erst im Oktober, dann am 3. November').from, '2026-10-01');
});

test('eventDate: a date in a hashtag or link is skipped, the real one is found', () => {
  assert.equal(ev('#14september https://x.de/14.09.2026 Wir feiern am 20.09.').from, '2026-09-20');
});

test('eventDate: impossible dates are ignored', () => {
  assert.equal(ev('Am 31.02.'), null);
  assert.equal(ev('Am 14.13.2026'), null);
  assert.equal(ev('16.–14.09.'), null);
});

const NEGATIVE = [
  'Open 14:30 to 18:00',
  'Heute ab 14.30 Uhr',
  'Nur 14.99 € pro Person',
  'Preis 14,99',
  'Schon 9.000 Besucher!',
  'Über 12.500 Gäste',
  '24/7 geöffnet',
  'Heimspiel 1. FC Köln',
  '3. Platz beim Turnier',
  'Alles unter https://example.com/events/14.09.2026',
  'Infos bei @party_14.09.2026',
  '#14september #september2026',
  'Tel. +49 911 1409 2026',
  'Ruf an: 0911 / 14 09 26',
  'Top 10 Cafés in Room 14',
  'You may 14 times try',
  'IP 192.168.1.1 und Version 2.0.2',
  '',
];

for (const caption of NEGATIVE) {
  test(`eventDate does not match "${caption}"`, () => {
    assert.equal(ev(caption), null);
  });
}

test('eventDate tolerates missing input', () => {
  assert.equal(eventDate(null), null);
  assert.equal(eventDate(undefined, {}), null);
});

test('formatDay: short English day', () => {
  assert.equal(formatDay('2019-01-04'), '4 Jan 2019');
  assert.equal(formatDay('2026-12-31'), '31 Dec 2026');
  assert.equal(formatDay(''), '');
  assert.equal(formatDay('2026-02-30'), '');
  assert.equal(formatDay('nonsense'), '');
});

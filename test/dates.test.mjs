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
  ['Opens May 2', '2027-05-02', '2027-05-02', '2 May 2027'], // next occurrence after the post
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

/** Shape of a rolled-forward suggestion: the whole month of the next occurrence. */
const yearlyMonth = (year, mm, last) => ({
  from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(new Date(Date.UTC(year, Number(mm), 0)).getUTCDate()).padStart(2, '0')}`,
  monthOnly: true, yearly: true,
  text: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1]} ${year}, probably yearly (last: ${last})`,
});

test('eventDate: past day without a year → month of the next occurrence, probably yearly', () => {
  assert.deepEqual(ev('14. September', { postedAt: '2025-08-01', today: '2026-10-10' }),
    yearlyMonth(2027, '09', '14 Sep 2025'));
  assert.deepEqual(ev('14.–16. September', { postedAt: '2025-08-01', today: '2026-10-10' }),
    { from: '2027-09-01', to: '2027-09-30', monthOnly: true, yearly: true, text: 'Sep 2027, probably yearly (last: 14–16 Sep 2025)' });
  assert.deepEqual(ev('Opens May 2', { postedAt: '2026-04-20', today: '2026-08-15' }), yearlyMonth(2027, '05', '2 May 2026'));
});

test('eventDate: a past range or month rolls forward to the next year’s month', () => {
  assert.deepEqual(ev('Fest 1.-3.8.', { today: '2026-08-15' }), yearlyMonth(2027, '08', '1–3 Aug 2026'));
  assert.deepEqual(ev('Immer im März', { postedAt: '2026-03-10', today: '2026-08-15' }), yearlyMonth(2027, '03', 'Mar 2026'));
  assert.deepEqual(ev('Wir waren im September da', { postedAt: '2025-08-01', today: '2026-10-10' }),
    { from: '2027-09-01', to: '2027-09-30', monthOnly: true, yearly: true, text: 'Sep 2027, probably yearly (last: Sep 2025)' });
  assert.equal(ev('Spargelzeit ab 1. Mrz').from, '2027-03-01');
  // The next occurrence is always in a later year, even while the month is still running.
  assert.equal(ev('Am 14.09.', { postedAt: '2026-09-01', today: '2026-09-20' }).text, 'Sep 2027, probably yearly (last: 14 Sep 2026)');
});

test('eventDate: an explicit year in the past (but no history) rolls forward the same way', () => {
  assert.deepEqual(ev('Recap vom 14.09.2026', { postedAt: '2026-09-20', today: '2026-10-10' }),
    yearlyMonth(2027, '09', '14 Sep 2026'));
  assert.deepEqual(ev('Opening September 2026', { postedAt: '2026-09-02', today: '2026-10-10' }),
    yearlyMonth(2027, '09', 'Sep 2026'));
  // A future explicit date stays exact.
  assert.equal(ev('Saisonstart 15. Mär 2027').text, '15 Mar 2027');
});

test('eventDate: without a year the occurrence closest to the post date is meant', () => {
  const dec = { postedAt: '2026-12-10', today: '2026-12-15' };
  assert.deepEqual(ev('Neujahrsmarkt 14.01.', dec),
    { from: '2027-01-14', to: '2027-01-14', monthOnly: false, yearly: false, text: '14 Jan 2027' });
  assert.deepEqual(ev('Wir sehen uns im Januar', dec),
    { from: '2027-01-01', to: '2027-01-31', monthOnly: true, yearly: false, text: 'Jan 2027' });
  // A recap posted after the event: over, so probably yearly.
  assert.deepEqual(ev('Danke für den 14. September!', { postedAt: '2026-09-20', today: '2026-10-10' }),
    yearlyMonth(2027, '09', '14 Sep 2026'));
  // Posted in January about last December's market.
  assert.deepEqual(ev('Rückblick 24.12.', { postedAt: '2026-01-05', today: '2026-01-06' }),
    yearlyMonth(2026, '12', '24 Dec 2025'));
});

test('eventDate: history (explicit date long before the post) is skipped', () => {
  for (const caption of ['Seit 14.09.2015 für euch da', 'Gegründet im Mai 1998', 'Open since August 2019', 'Born on 14.09.1985']) {
    assert.equal(ev(caption, { postedAt: '2026-08-01', today: '2026-08-15' }), null, caption);
  }
  // Without a post date the cutoff is a year before today.
  assert.equal(ev('Seit 14.09.2015', { postedAt: '', today: '2026-08-15' }), null);
  assert.equal(ev('Fest am 14.09.2025', { postedAt: '', today: '2026-08-15' }).text, 'Sep 2026, probably yearly (last: 14 Sep 2025)');
  assert.equal(ev('Fest am 14.07.2025', { postedAt: '', today: '2026-08-15' }), null);
  // Up to 30 days before the post still counts, and a later date in the caption is found.
  assert.equal(ev('Am 03.07.2026 war es voll', { postedAt: '2026-08-01' }).text, 'Jul 2027, probably yearly (last: 3 Jul 2026)');
  assert.equal(ev('Am 01.07.2026 war es voll', { postedAt: '2026-08-01' }), null);
  assert.equal(ev('Seit 14.09.2015 dabei, Jubiläum am 20.09.').from, '2026-09-20');
});

test('eventDate: two days joined by und / and / & are a span', () => {
  assert.deepEqual(ev('Flohmarkt am 1. und 2. Oktober'),
    { from: '2026-10-01', to: '2026-10-02', monthOnly: false, yearly: false, text: '1–2 Oct 2026' });
  assert.equal(ev('Open Oct 3 and 4').text, '3–4 Oct 2026');
  assert.equal(ev('Markt 5. & 6.9.').text, '5–6 Sep 2026');
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
  // Opening hours, prices, distances and counts after a month word
  'Ab März 10-18 Uhr geöffnet',
  'Ab Mai 11-22 Uhr Biergarten',
  'April bis Oktober 10-18 Uhr',
  'Öffnungszeiten Mai - Sept 9-17 Uhr',
  'Sommer: Jun-Aug 10-20h',
  'June 10am-2pm',
  'März 10 Uhr',
  'Juni 12 Euro Eintritt',
  'Mai 14 Euro',
  'Sep 10 km run',
  'Oct 10 years anniversary',
  'Seit März 3 neue Sorten',
  'We march 4 miles',
  'They march in march',
  'mar 3 wins',
  'Ich mag den Mai 2 mal',
  'with Jan 2 friends',
];

test('eventDate: hours after "in June" / "Im April" never become a day', () => {
  for (const caption of ['Every Sunday in June 10am-2pm', 'Im April 5 Tage Rom']) {
    const r = ev(caption);
    assert.ok(r === null || r.monthOnly, `${caption} → ${r?.text}`);
  }
});

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

/* ---------------- Fix round 2 ---------------- */

test('eventDate: a bare "Jan <day>" is a date unless it reads like the name Jan', () => {
  for (const [caption, day] of [['Jan 14', 14], ['Opens Jan 14', 14], ['Jan 14 at 8pm', 14],
    ['Join us Jan 10!', 10], ['Sat, Jan 10', 10], ['jan 14', 14]]) {
    assert.equal(ev(caption)?.text, `${day} Jan 2027`, caption);
  }
  assert.equal(ev('with Jan 2 friends'), null);
  assert.equal(ev('Kaffee mit Jan 2 Stunden lang'), null);
  assert.equal(ev('Jan 3 kids, one table'), null);
});

const NOT_DAYS = [
  'Juni bis August 18 Grad Wassertemperatur',
  'Oct 5 stars on Tripadvisor',
  'Sept 5 dollar cocktails',
  'Sep 10 k run',
  'Aug 5 Leute gesucht',
  'Jun 3 Gänge Menü',
  'Apr 4 Personen',
  'Nov 20° im Schatten',
  'Dec 8 $ drinks',
  'Mar 12 guests max',
];
for (const caption of NOT_DAYS) {
  test(`eventDate gives no day for "${caption}"`, () => {
    assert.equal(ev(caption), null);
  });
}

test('eventDate: "und / and / &" is a span only for two days in a row', () => {
  assert.equal(ev('am 1. und 2. Oktober').text, '1–2 Oct 2026');
  assert.equal(ev('Open Oct 3 and 4').text, '3–4 Oct 2026');
  assert.equal(ev('Dec 24 & 31').text, '24 Dec 2026');
  assert.equal(ev('14. und 21. September').text, '14 Sep 2026');
  assert.equal(ev('Markt am 5. & 12.9.').text, '5 Sep 2026');
});

test('eventDate: lowercase may / march count as months when the day comes first', () => {
  const spring = { postedAt: '2026-04-01', today: '2026-04-02' };
  assert.equal(ev('see you 14 may 2026', spring).text, '14 May 2026');
  assert.equal(ev('14 march 2027', spring).text, '14 Mar 2027');
  assert.equal(ev('we march 4 miles', spring), null);
  assert.equal(ev('you may 14 times try', spring), null);
});

test('eventDate: spans across two months', () => {
  assert.deepEqual(ev('Herbstfest 30.09.–02.10.'),
    { from: '2026-09-30', to: '2026-10-02', monthOnly: false, yearly: false, text: '30 Sep – 2 Oct 2026' });
  assert.equal(ev('Pop-up Oct 12 – Nov 3').text, '12 Oct – 3 Nov 2026');
  assert.deepEqual(ev('Biergarten geöffnet vom 15. März bis 31. Oktober'),
    { from: '2026-03-15', to: '2026-10-31', monthOnly: false, yearly: false, text: '15 Mar – 31 Oct 2026' });
  assert.equal(ev('Open from March 15 to October 31').text, '15 Mar – 31 Oct 2026');
  assert.equal(ev('Open from March 15, 2026 to October 31, 2026').text, '15 Mar – 31 Oct 2026');
  assert.equal(ev('15. März 2026 bis 31. Oktober 2026').text, '15 Mar – 31 Oct 2026');
});

test('eventDate: a span over New Year ends in the next year', () => {
  assert.deepEqual(ev('Eisbahn 15.12.–06.01.'),
    { from: '2026-12-15', to: '2027-01-06', monthOnly: false, yearly: false, text: '15 Dec 2026 – 6 Jan 2027' });
  assert.equal(ev('Wintermarkt 15.12.–06.01.2027').from, '2026-12-15');
  assert.equal(ev('Wintermarkt 15.12.2026–06.01.2027').to, '2027-01-06');
  // Seen in January while it is still on: the running season, not next winter.
  assert.equal(ev('Eisbahn 1.12.–28.02.', { postedAt: '2027-01-15', today: '2027-01-20' }).text, '1 Dec 2026 – 28 Feb 2027');
});

test('eventDate: a running season is not yearly; an ended one gives its start month next year', () => {
  assert.equal(ev('vom 15. März bis 31. Oktober', { postedAt: '2026-10-20', today: '2026-10-25' }).yearly, false);
  assert.deepEqual(ev('vom 15. März bis 31. Oktober', { postedAt: '2025-05-01', today: '2026-11-05' }),
    { from: '2027-03-01', to: '2027-03-31', monthOnly: true, yearly: true,
      text: 'Mar 2027, probably yearly (last: 15 Mar – 31 Oct 2025)' });
});

/* ---------------- Fix round 3 ---------------- */

test('eventDate: without a year the next occurrence from the post date on is meant (30 days grace)', () => {
  const cases = [
    ['Wir sehen uns im Dezember', '2026-06-10', '2026-08-15', { from: '2026-12-01', to: '2026-12-31', monthOnly: true, yearly: false, text: 'Dec 2026' }],
    ['Wieder offen im Januar', '2026-07-10', '2026-08-15', { from: '2027-01-01', to: '2027-01-31', monthOnly: true, yearly: false, text: 'Jan 2027' }],
    ['Eröffnung Ende März', '2026-09-05', '2026-09-10', { from: '2027-03-01', to: '2027-03-31', monthOnly: true, yearly: false, text: 'Mar 2027' }],
    ['Weihnachtsmarkt 27.11.–23.12.', '2026-06-01', '2026-08-15', { from: '2026-11-27', to: '2026-12-23', monthOnly: false, yearly: false, text: '27 Nov – 23 Dec 2026' }],
    ['Neujahrsmarkt 14.01.', '2026-12-10', '2026-12-15', { from: '2027-01-14', to: '2027-01-14', monthOnly: false, yearly: false, text: '14 Jan 2027' }],
    ['Danke für den 14. September!', '2026-09-20', '2026-10-10', { from: '2027-09-01', to: '2027-09-30', monthOnly: true, yearly: true, text: 'Sep 2027, probably yearly (last: 14 Sep 2026)' }],
    ['14. September', '2025-08-01', '2026-10-10', { from: '2027-09-01', to: '2027-09-30', monthOnly: true, yearly: true, text: 'Sep 2027, probably yearly (last: 14 Sep 2025)' }],
    ['vom 15. März bis 31. Oktober', '2026-10-20', '2026-10-25', { from: '2026-03-15', to: '2026-10-31', monthOnly: false, yearly: false, text: '15 Mar – 31 Oct 2026' }],
  ];
  for (const [caption, postedAt, today, expected] of cases) {
    assert.deepEqual(ev(caption, { postedAt, today }), expected, `${caption} (${postedAt} / ${today})`);
  }
});

test('eventDate: an old post whose season is on again today suggests the running season', () => {
  assert.deepEqual(ev('vom 15. März bis 31. Oktober', { postedAt: '2025-05-01', today: '2026-05-01' }),
    { from: '2026-03-15', to: '2026-10-31', monthOnly: false, yearly: true, text: '15 Mar – 31 Oct 2026 (probably yearly)' });
  // Outside the season it is the month level again.
  assert.equal(ev('vom 15. März bis 31. Oktober', { postedAt: '2025-05-01', today: '2026-11-05' }).text,
    'Mar 2027, probably yearly (last: 15 Mar – 31 Oct 2025)');
});

test('eventDate: "K-" after a day is no unit', () => {
  assert.equal(ev('Nov 7 K-Pop Night').text, '7 Nov 2026');
  assert.equal(ev('Sep 10 k run'), null);
});

test('eventDate: a rejected span across months gives no part of it', () => {
  assert.equal(ev('from march 15 to october 31'), null);
  assert.equal(ev('from march 15 to october 31, then again on 20.09.').text, '20 Sep 2026');
});

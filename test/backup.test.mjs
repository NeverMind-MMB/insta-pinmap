import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBackupHtml, readBackupText, backupAgeText, needsBackupReminder } from '../web/js/backup.js';

const db = {
  version: 1, changedAt: 5, tags: [{ name: 'coffee', color: '#b8543f' }], deleted: [{ id: 'x', deletedAt: '2026-01-01T00:00:00.000Z' }],
  pins: [{ id: 'p1', lat: 49.45, lon: 11.07, title: 'Bad </script><b>title', address: 'A & B', note: 'line sep',
    status: 'visited', tags: ['coffee'], posts: [{ url: 'https://www.instagram.com/p/AAA111/', shortcode: 'AAA111' }] }],
};
const html = () => buildBackupHtml(db, { leafletJs: '/*leaflet*/', leafletCss: '.x{background:url(images/a.png)}', colorOf: () => '#b8543f', now: new Date('2026-10-04T12:00:00Z') });

test('HTML backup round trip keeps every field, even </script> in a title', () => {
  assert.deepEqual(readBackupText(html()), db);
});

test('HTML backup contains no raw </script> from data and is noindex', () => {
  const h = html();
  assert.equal(h.split('</script>').length - 1, 3); // the three script elements only
  assert.match(h, /<meta name="robots" content="noindex, nofollow">/);
});

test('JSON backups from the old app still load', () => {
  assert.equal(readBackupText(JSON.stringify({ pins: [] , stand: 1 })).stand, 1);
});

test('Files that are not backups are refused', () => {
  for (const t of ['', 'hello', '{"a":1}', '<html><body>no data</body></html>']) {
    assert.throws(() => readBackupText(t), /isn't a backup/);
  }
});

test('Backup age text', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  assert.equal(backupAgeText(null, now), 'Never');
  assert.equal(backupAgeText('2026-10-04T08:00:00Z', now), 'Today');
  assert.equal(backupAgeText('2026-10-03T08:00:00Z', now), '1 day ago');
  assert.equal(backupAgeText('2026-09-01T08:00:00Z', now), '33 days ago');
});

test('Reminder only with pins and after 30 days or never', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  assert.equal(needsBackupReminder(null, 0, now), false);
  assert.equal(needsBackupReminder(null, 3, now), true);
  assert.equal(needsBackupReminder('2026-09-10T00:00:00Z', 3, now), false);
  assert.equal(needsBackupReminder('2026-09-03T00:00:00Z', 3, now), true);
});

test('Hostile colour and javascript: link never reach the viewer markup', () => {
  const bad = { version: 1, tags: [{ name: 'x', color: '"><img src=x onerror=alert(1)>' }],
    pins: [{ id: 'p', lat: 1, lon: 2, title: 't', tags: ['x'], posts: [{ url: 'javascript:alert(1)' }] }] };
  const h = buildBackupHtml(bad, { leafletJs: '', leafletCss: '', colorOf: () => bad.tags[0].color });
  const rest = h.slice(h.indexOf('</script>') + 9);
  const viewerData = rest.slice(rest.indexOf('var P='), rest.indexOf('var m=L.map'));
  assert.doesNotMatch(viewerData.replace(/"u":\[[^\]]*\]/, ''), /onerror/);
  assert.match(viewerData, /#8a8f98/);
  assert.doesNotMatch(rest.replace(viewerData, ''), /onerror|javascript:/);
});

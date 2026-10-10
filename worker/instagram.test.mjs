import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeEntities, metaContent, parseDescription, parsePostPage, fetchPost, imageAsDataUrl,
} from './instagram.js';

// Modelled on the real page returned to Googlebot on 2026-10-03.
const PAGE = `<html><head>
<meta property="og:type" content="article" />
<meta name="description" content="60M likes, 4M comments - world_record_egg am January 4, 2019: &quot;Let&#x2019;s set a world record &#x1f64c; &quot;together&quot;\nline two #LikeTheEgg&quot;" />
<meta property="og:image" content="https://scontent.cdninstagram.com/v/abc.jpg?stp=x&amp;_nc_cat=104" />
</head><body></body></html>`;

test('decodeEntities handles hex, decimal and named entities', () => {
  assert.equal(decodeEntities('&#x2019;&#8217;&amp;&quot;&#x1f64c;&bogus;'), '’’&"🙌&bogus;');
});

test('metaContent finds name= and property= in any attribute order', () => {
  assert.match(metaContent(PAGE, 'description'), /^60M likes/);
  assert.equal(metaContent('<meta content="X" property="og:image">', 'og:image'), 'X');
  assert.equal(metaContent(PAGE, 'og:title'), null);
});

test('parseDescription keeps quotes and line breaks inside the caption', () => {
  const r = parseDescription(metaContent(PAGE, 'description'));
  assert.equal(r.username, 'world_record_egg');
  assert.equal(r.caption, 'Let’s set a world record 🙌 "together"\nline two #LikeTheEgg');
});

test('parseDescription: empty caption and unknown format', () => {
  assert.deepEqual(parseDescription('5 likes, 0 comments - some.user on May 1, 2026: ""'), { username: 'some.user', caption: '' });
  assert.deepEqual(parseDescription('Something else entirely'), { username: '', caption: 'Something else entirely' });
});

test('parsePostPage returns the decoded image URL', () => {
  const r = parsePostPage(PAGE);
  assert.equal(r.imageUrl, 'https://scontent.cdninstagram.com/v/abc.jpg?stp=x&_nc_cat=104');
  assert.equal(parsePostPage('<html><head></head></html>'), null);
});

const fakeFetch = (pages) => async (url, opts) => {
  const next = pages.shift();
  return new Response(next.body ?? '', { status: next.status ?? 200 });
};

test('fetchPost: success on first crawler', async () => {
  const r = await fetchPost('BsOGulcndj-', fakeFetch([{ body: PAGE }]));
  assert.equal(r.ok, true);
  assert.equal(r.username, 'world_record_egg');
});

test('fetchPost: image-only post is still ok', async () => {
  const page = '<meta name="description" content="1 likes, 0 comments - a on May 1, 2026: &quot;&quot;"><meta property="og:image" content="https://x/y.jpg">';
  const r = await fetchPost('ABCDE', fakeFetch([{ body: page }]));
  assert.equal(r.ok, true);
  assert.equal(r.caption, '');
});

test('fetchPost: second crawler is tried after a failure', async () => {
  const r = await fetchPost('ABCDE', fakeFetch([{ status: 302 }, { body: PAGE }]));
  assert.equal(r.ok, true);
});

test('fetchPost: both fail → ok false with the last reason', async () => {
  const r = await fetchPost('ABCDE', fakeFetch([{ status: 429 }, { body: '<html></html>' }]));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-found');
});

test('fetchPost refuses anything that is not a shortcode', async () => {
  const r = await fetchPost('../etc/passwd', async () => { throw new Error('must not fetch'); });
  assert.equal(r.reason, 'bad-code');
});

test('imageAsDataUrl: small image inlined, big or non-image dropped', async () => {
  const img = (bytes, type) => async () => new Response(new Uint8Array(bytes), { headers: { 'Content-Type': type } });
  assert.match(await imageAsDataUrl('https://scontent.cdninstagram.com/a.jpg', img([1, 2, 3], 'image/jpeg')), /^data:image\/jpeg;base64,AQID$/);
  assert.equal(await imageAsDataUrl('https://scontent.cdninstagram.com/a.jpg', img(new Array(300000).fill(0), 'image/jpeg')), '');
  assert.equal(await imageAsDataUrl('https://scontent.cdninstagram.com/a.html', img([1], 'text/html')), '');
  assert.equal(await imageAsDataUrl('', img([1], 'image/png')), '');
});

test('imageAsDataUrl: blocks http, foreign hosts, and look-alike domains without fetching', async () => {
  const throwingFetch = async () => { throw new Error('must not fetch'); };
  // HTTP URL
  assert.equal(await imageAsDataUrl('http://scontent.cdninstagram.com/a.jpg', throwingFetch), '');
  // Foreign host
  assert.equal(await imageAsDataUrl('https://example.com/a.jpg', throwingFetch), '');
  // Look-alike domain
  assert.equal(await imageAsDataUrl('https://cdninstagram.com.evil.example/a.jpg', throwingFetch), '');
});

test('parsePostPage reads only the head', async () => {
  const { headOnly } = await import('./instagram.js');
  const body = '<body>' + 'x'.repeat(1000) + '<meta property="og:image" content="https://scontent.cdninstagram.com/late.jpg"></body>';
  assert.equal(headOnly('<HTML><Head><title>t</title></HEAD >' + body), '<HTML><Head><title>t</title>');
  assert.equal(parsePostPage('<html><head></head>' + body), null, 'meta tags after </head> are ignored');
  assert.equal(parsePostPage(PAGE + body).imageUrl, 'https://scontent.cdninstagram.com/v/abc.jpg?stp=x&_nc_cat=104');
});

// test/postlinks.test.mjs — YouTube and Facebook links (web/js/postlinks.js), all synthetic IDs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  youtubeId, facebookTarget, postRequestKey, socialPostKey, canonicalPostLink, postEmbedLink,
  postSiteName, isSocialLink, candidateText,
} from '../web/js/postlinks.js';

const YT = 'AbCdEfGh_-1';

test('youtubeId: watch, Shorts, live, embed, youtu.be and m.youtube.com, with or without the scheme', () => {
  for (const link of [
    `https://www.youtube.com/watch?v=${YT}`,
    `https://www.youtube.com/watch?v=${YT}&t=42s&list=PLx`,
    `https://m.youtube.com/watch?v=${YT}&feature=share`,
    `https://youtube.com/shorts/${YT}?si=SyntheticShare`,
    `https://www.youtube.com/live/${YT}`,
    `https://www.youtube.com/embed/${YT}`,
    `https://youtu.be/${YT}?si=SyntheticShare`,
    `youtu.be/${YT}`,
    `http://www.youtube.com/watch/?v=${YT}`,
  ]) {
    assert.equal(youtubeId(link), YT, link);
  }
  for (const link of [
    'https://www.youtube.com/@synthetic.channel', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/',
    `https://youtube.com.evil.example/watch?v=${YT}`, `https://notyoutube.com/watch?v=${YT}`, `ftp://youtu.be/${YT}`,
    'https://www.youtube.com/playlist?list=PLx', '', null,
  ]) {
    assert.equal(youtubeId(link), '', String(link));
  }
});

test('facebookTarget: posts, reels, videos, permalinks and photos are posts with their numeric or pfbid key', () => {
  const cases = {
    'https://www.facebook.com/SyntheticPage/posts/1234567890123456': 'fb:1234567890123456',
    'https://www.facebook.com/SyntheticPage/posts/pfbid0SyntheticAbCdEfGhIjKlMnOpQrStUvWxYz123/': 'fb:pfbid0SyntheticAbCdEfGhIjKlMnOpQrStUvWxYz123',
    'https://www.facebook.com/SyntheticPage/posts/some-words-of-the-text/1234567890123456/': 'fb:1234567890123456',
    'https://www.facebook.com/reel/987654321098765/?mibextid=xyz': 'fb:987654321098765',
    'https://m.facebook.com/watch/?v=987654321098765': 'fb:987654321098765',
    'https://www.facebook.com/SyntheticPage/videos/987654321098765/': 'fb:987654321098765',
    'https://www.facebook.com/SyntheticPage/videos/a-slug-of-the-title/987654321098765/': 'fb:987654321098765',
    'https://www.facebook.com/permalink.php?story_fbid=1234567890123456&id=100000000000001': 'fb:1234567890123456',
    'https://www.facebook.com/story.php?story_fbid=pfbid0SyntheticAbCdEfGhIjKlMnOpQrSt&id=100000000000001': 'fb:pfbid0SyntheticAbCdEfGhIjKlMnOpQrSt',
    'https://www.facebook.com/photo/?fbid=1234567890123456': 'fb:1234567890123456',
  };
  for (const [link, key] of Object.entries(cases)) {
    const t = facebookTarget(link);
    assert.equal(t?.kind, 'post', link);
    assert.equal(t.key, key, link);
    assert.equal(socialPostKey(link), key, link);
    assert.equal(postRequestKey(link), key, link);
    assert.ok(t.url.startsWith('https://www.facebook.com/'), link);
  }
});

test('facebookTarget: share links and fb.watch are resolved by the Worker; their key is the share code', () => {
  const cases = {
    'https://www.facebook.com/share/r/SynThCode1/': 'fb:s:SynThCode1',
    'https://www.facebook.com/share/p/SynThCode2/?mibextid=abc': 'fb:s:SynThCode2',
    'https://www.facebook.com/share/v/SynThCode3/': 'fb:s:SynThCode3',
    'https://www.facebook.com/share/SynThCode4/': 'fb:s:SynThCode4',
    'https://m.facebook.com/share/r/SynThCode5/': 'fb:s:SynThCode5',
    'https://fb.watch/SynThW1/': 'fb:w:SynThW1',
  };
  for (const [link, key] of Object.entries(cases)) {
    const t = facebookTarget(link);
    assert.equal(t?.kind, 'share', link);
    assert.equal(postRequestKey(link), key, link);
    assert.equal(socialPostKey(link), '', `${link}: no post key before the Worker read it`);
  }
  assert.equal(facebookTarget('https://www.facebook.com/share/r/SynThCode1/').url, 'https://www.facebook.com/share/r/SynThCode1/');
  assert.equal(facebookTarget('https://fb.watch/SynThW1/').url, 'https://fb.watch/SynThW1/');
});

test('facebookTarget: page links (name, profile.php, /about) are pages with an about address', () => {
  const cases = {
    'https://www.facebook.com/SyntheticCafe': ['fb:page:syntheticcafe', 'https://www.facebook.com/SyntheticCafe/about/'],
    'https://www.facebook.com/SyntheticCafe/': ['fb:page:syntheticcafe', 'https://www.facebook.com/SyntheticCafe/about/'],
    'https://m.facebook.com/synthetic.cafe.berlin/about/': ['fb:page:synthetic.cafe.berlin', 'https://www.facebook.com/synthetic.cafe.berlin/about/'],
    'https://www.facebook.com/profile.php?id=100000000000001': ['fb:page:100000000000001', 'https://www.facebook.com/profile.php?id=100000000000001&sk=about'],
  };
  for (const [link, [key, about]] of Object.entries(cases)) {
    const t = facebookTarget(link);
    assert.equal(t?.kind, 'page', link);
    assert.equal(t.key, key, link);
    assert.equal(t.aboutUrl, about, link);
    assert.equal(socialPostKey(link), '', link);
  }
});

test('facebookTarget: other Facebook links, lookalikes and other sites are nothing', () => {
  for (const link of [
    'https://www.facebook.com/', 'https://www.facebook.com/watch/', 'https://www.facebook.com/groups/', 'https://www.facebook.com/login/',
    'https://www.facebook.com/marketplace/item/123456', 'https://www.facebook.com/reel/abc', 'https://www.facebook.com/profile.php?id=abc',
    'https://facebook.com.evil.example/SyntheticCafe', 'https://notfacebook.com/SyntheticCafe', 'https://fb.watch/', 'Cafe Luitpold', '', null,
  ]) {
    assert.equal(facebookTarget(link), null, String(link));
  }
});

test('web.facebook.com and mbasic.facebook.com links are Facebook\'s too: same key, read at www.facebook.com', async () => {
  const { sourceOf } = await import('../web/js/sources.js');
  const PFBID = 'pfbid0SyntheticSyntheticSynthetic1';
  for (const host of ['web.facebook.com', 'mbasic.facebook.com']) {
    const post = `https://${host}/SyntheticCafe/posts/${PFBID}`;
    assert.equal(sourceOf(post), 'facebook', post);
    assert.equal(isSocialLink(post), true, post);
    assert.equal(postRequestKey(post), `fb:${PFBID}`, post);
    assert.equal(canonicalPostLink(post), `https://www.facebook.com/SyntheticCafe/posts/${PFBID}`, post);
    assert.equal(postRequestKey(`https://${host}/reel/1234567890123`), 'fb:1234567890123');
    assert.deepEqual(facebookTarget(`https://${host}/SyntheticCafe`),
      { kind: 'page', key: 'fb:page:syntheticcafe', aboutUrl: 'https://www.facebook.com/SyntheticCafe/about/' });
    assert.equal(facebookTarget(`https://${host}/share/p/SynthShare1/`).url, 'https://www.facebook.com/share/p/SynthShare1/');
    assert.equal(sourceOf(`https://${host}.evil.example/SyntheticCafe`), null, 'lookalike');
    assert.equal(facebookTarget(`https://${host}.evil.example/SyntheticCafe`), null, 'lookalike');
  }
  assert.equal(sourceOf('https://evilweb.facebook.com.example/x'), null);
  assert.equal(facebookTarget('https://touch.facebook.com.evil.example/SyntheticCafe'), null);
});

test('postRequestKey and socialPostKey: YouTube is yt:<id>; other links have none', () => {
  assert.equal(postRequestKey(`https://youtu.be/${YT}`), `yt:${YT}`);
  assert.equal(socialPostKey(`https://www.youtube.com/shorts/${YT}`), `yt:${YT}`);
  for (const link of ['https://www.instagram.com/p/ABC123/', 'https://maps.app.goo.gl/x', 'https://www.youtube.com/@x', '']) {
    assert.equal(postRequestKey(link), '', link);
    assert.equal(socialPostKey(link), '', link);
  }
  assert.ok(postRequestKey(`https://youtu.be/${YT}`).length <= 24, 'the whole key goes into the work ticket');
});

test('canonicalPostLink: one form per video or post, without share and tracking parameters', () => {
  assert.equal(canonicalPostLink(`https://youtu.be/${YT}?si=SyntheticShare`), `https://www.youtube.com/watch?v=${YT}`);
  assert.equal(canonicalPostLink(`https://m.youtube.com/shorts/${YT}`), `https://www.youtube.com/watch?v=${YT}`);
  assert.equal(canonicalPostLink('https://m.facebook.com/reel/987654321098765/?mibextid=xyz&rdid=abc'), 'https://www.facebook.com/reel/987654321098765/');
  assert.equal(canonicalPostLink('https://www.facebook.com/watch/?v=987654321098765&ref=sharing'), 'https://www.facebook.com/watch/?v=987654321098765');
  assert.equal(canonicalPostLink('https://www.facebook.com/permalink.php?story_fbid=1234567890123456&id=100000000000001&ref=x'),
    'https://www.facebook.com/permalink.php?story_fbid=1234567890123456&id=100000000000001');
  assert.equal(canonicalPostLink('https://www.facebook.com/share/r/SynThCode1/'), '', 'a share link is no post yet');
  assert.equal(canonicalPostLink('https://www.facebook.com/SyntheticCafe'), '');
  assert.equal(canonicalPostLink('https://www.instagram.com/p/ABC123/'), '');
});

test('postEmbedLink: YouTube without cookies, Facebook posts and videos through its plugins', () => {
  assert.equal(postEmbedLink(`https://youtu.be/${YT}`), `https://www.youtube-nocookie.com/embed/${YT}`);
  assert.equal(postEmbedLink('https://www.facebook.com/SyntheticPage/posts/1234567890123456'),
    `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent('https://www.facebook.com/SyntheticPage/posts/1234567890123456')}&show_text=true`);
  assert.match(postEmbedLink('https://www.facebook.com/reel/987654321098765/'), /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
  assert.equal(postEmbedLink('https://www.facebook.com/SyntheticCafe'), '');
  assert.equal(postEmbedLink('https://www.instagram.com/p/ABC123/'), '');
});

test('postSiteName and isSocialLink go by the link\'s source (sources.js)', () => {
  assert.equal(postSiteName(`https://youtu.be/${YT}`), 'YouTube');
  assert.equal(postSiteName('https://www.facebook.com/reel/987654321098765/'), 'Facebook');
  assert.equal(postSiteName('https://www.instagram.com/p/ABC123/'), '');
  assert.equal(isSocialLink('https://fb.watch/SynThW1/'), true);
  assert.equal(isSocialLink('https://www.youtube.com/@synthetic.channel'), true, 'any YouTube link: the reader tells a video from the rest');
  assert.equal(isSocialLink('https://www.instagram.com/p/ABC123/'), false);
  assert.equal(isSocialLink('https://vimeo.com/123456'), false);
});

test('postAuthorLabel and postLinkText: channel and page names as they are; Instagram usernames with "@"', async () => {
  const { postAuthorLabel, postLinkText } = await import('../web/js/postlinks.js');
  assert.equal(postAuthorLabel(`https://www.youtube.com/watch?v=${YT}`, 'Synthetic Channel'), 'Synthetic Channel');
  assert.equal(postAuthorLabel('https://www.facebook.com/reel/987654321098765/', 'Synthetic Page'), 'Synthetic Page');
  assert.equal(postAuthorLabel('https://www.instagram.com/p/ABC123/', 'synthetic.user'), '@synthetic.user');
  assert.equal(postAuthorLabel('https://www.instagram.com/p/ABC123/', ''), '');
  assert.equal(postLinkText(`https://www.youtube.com/watch?v=${YT}`, 'Synthetic Channel'), 'Synthetic Channel on YouTube');
  assert.equal(postLinkText(`https://www.youtube.com/watch?v=${YT}`, ''), 'Open on YouTube');
  assert.equal(postLinkText('https://www.facebook.com/reel/987654321098765/', ''), 'Open on Facebook');
  assert.equal(postLinkText('https://www.instagram.com/p/ABC123/', 'synthetic.user'), '@synthetic.user');
  assert.equal(postLinkText('https://www.instagram.com/p/ABC123/', ''), 'Open on Instagram');
});

/* ---------- The text the place candidates come from ---------- */

test('candidateText: the title plus the description up to the first boilerplate line', () => {
  const description = [
    'We tried the pasta at Trattoria Sintetica in Testhausen.', '', 'Best carbonara so far!',
    'Subscribe for more food videos', 'Follow me on Instagram', 'Music: Synthetic Beats',
  ].join('\n');
  assert.equal(candidateText('Eating in Testhausen', description),
    'Eating in Testhausen\nWe tried the pasta at Trattoria Sintetica in Testhausen.\n\nBest carbonara so far!');
});

test('candidateText: later lines with 📍, "Address:" or "Location:" are kept; a run of links ends the text', () => {
  const description = [
    'A day at the lake.', 'https://example.com/gear', 'https://example.com/shop', 'More text after the links',
    '📍 Seehaus Sintetico, Testweg 1, Testhausen', 'Address: Testweg 1, 12345 Testhausen', 'Location: Testhausen Lake',
  ].join('\n');
  assert.equal(candidateText('Lake day', description), [
    'Lake day', 'A day at the lake.', '📍 Seehaus Sintetico, Testweg 1, Testhausen', 'Address: Testweg 1, 12345 Testhausen',
    'Location: Testhausen Lake',
  ].join('\n'));
});

test('candidateText: at most about 600 characters of description; a single long paragraph is cut, not dropped', () => {
  const long = 'Word '.repeat(300).trim();
  const text = candidateText('Title', long);
  assert.ok(text.startsWith('Title\nWord Word'));
  assert.ok(text.length <= 'Title\n'.length + 600, String(text.length));
  assert.equal(candidateText('Only a title', ''), 'Only a title');
  assert.equal(candidateText('', 'Just text'), 'Just text');
});

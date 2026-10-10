import { test } from 'node:test';
import assert from 'node:assert/strict';

const { startAdd } = await import('../web/js/addflow.js');

/** Replaces fetch for /api/resolve; returns the list of resolve calls. */
function stubResolve(answer) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify(answer(calls.length)), { headers: { 'content-type': 'application/json' } });
  };
  return calls;
}

function fakeUi() {
  const toasts = [];
  return { toasts, ui: { toast: (text, kind) => toasts.push([text, kind]), hideToast: () => {} } };
}

test('short link that leads nowhere: one request and a message, no loop', async () => {
  const link = 'https://maps.app.goo.gl/deadLink123';
  for (const answer of [
    () => ({ ok: false, message: "This short link doesn't lead anywhere." }),
    () => ({ ok: true, url: link }), // an old Worker answering with the same address
  ]) {
    const calls = stubResolve(answer);
    const { toasts, ui } = fakeUi();
    await startAdd(link, ui);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^\/api\/resolve\?url=/);
    assert.equal(toasts.at(-1)[1], 'error');
    assert.match(toasts.at(-1)[0], /short link/);
  }
});

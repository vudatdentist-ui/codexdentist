const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');
function harness(response = () => Response.json({ ok: true }), origins = 'https://provider.test,http://127.0.0.1:12345,http://codexdentist-orthanc:8042') {
  const calls = [];
  const api = load('src/integrations/optional-http.ts', {}, { Headers, Response, process: { env: { OPTIONAL_PROVIDER_ALLOWED_ORIGINS: origins } },
    fetch: async (...args) => { calls.push(args); return response(...args); } });
  return { ...api, calls };
}
test('provider fetch accepts approved origin, bounds response and never forwards cookies', async () => {
  const h = harness(() => Response.json({ ok: true }, { headers: { 'set-cookie': 'synthetic=private' } }));
  const response = await h.optionalProviderFetch('https://provider.test/v1/profile?scope=account', { headers: { authorization: 'synthetic-key' }, redirect: 'follow' });
  assert.equal((await response.json()).ok, true);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(h.calls[0][1].redirect, 'manual');
  assert.equal(h.calls[0][1].cache, 'no-store');
});
for (const value of ['https://other.test', 'https://provider.test.evil.test', 'https://user:key@provider.test',
  'https://provider.test/#secret', 'file:///etc/passwd', 'http://169.254.169.254/latest/meta-data', 'http://2852039166/',
  'http://metadata.google.internal/', 'http://provider.test', 'https://provider.test:8443']) {
  test(`unapproved provider target never reaches HTTP: ${value}`, async () => {
    const h = harness(); await assert.rejects(h.optionalProviderFetch(value), { code: 'integration-origin-not-allowed' }); assert.equal(h.calls.length, 0);
  });
}
test('empty or non-origin root approval fails closed', async () => {
  for (const allowed of ['', 'https://provider.test/private', 'https://user:key@provider.test']) {
    const h = harness(undefined, allowed);
    await assert.rejects(h.optionalProviderFetch('https://provider.test'), { code: 'integration-origin-not-allowed' });
    assert.equal(h.calls.length, 0);
  }
});
test('explicit internal origin works while public HTTP remains forbidden even if approved', async () => {
  const h = harness(); assert.equal((await h.optionalProviderFetch('http://codexdentist-orthanc:8042/system')).status, 200);
  const publicHttp = harness(undefined, 'http://provider.test');
  await assert.rejects(publicHttp.optionalProviderFetch('http://provider.test'), { code: 'integration-origin-not-allowed' });
});
test('redirect response never forwards a credential to a different endpoint', async () => {
  const h = harness(() => new Response(null, { status: 302, headers: { location: 'https://other.test/steal' } }));
  await assert.rejects(h.optionalProviderFetch('https://provider.test'), { code: 'integration-provider-redirect' });
  assert.equal(h.calls.length, 1);
});
test('response bounds cover both declared and streamed payloads', async () => {
  for (const headers of [{}, { 'content-length': '50000' }]) {
    const h = harness(() => new Response('a'.repeat(100), { headers }));
    await assert.rejects(h.optionalProviderFetch('https://provider.test', {}, { maxBytes: 50 }), { code: 'integration-response-too-large' });
  }
});
test('provider errors expose no raw transport details', async () => {
  const h = harness(() => { throw new Error('synthetic-sensitive-transport'); });
  await assert.rejects(h.optionalProviderFetch('https://provider.test'), error => error.code === 'integration-provider-unavailable' && !error.message.includes('sensitive'));
});
test('204 responses have no reconstructed body', async () => {
  const h = harness(() => new Response(null, { status: 204 }));
  assert.equal((await h.optionalProviderFetch('https://provider.test')).status, 204);
});

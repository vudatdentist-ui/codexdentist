const assert = require('node:assert/strict');
const { test } = require('node:test');
const { verificationToken, requestHeaders } = require('./owned-signing-bootstrap-client.cjs');

test('pinned CE verification links use an opaque path token, in both text and HTML', () => {
  const token = 'b'.repeat(40), url = `https://sign.codexdentist.com/verify-email/${token}`;
  assert.equal(verificationToken(`Verify your email:\n${url}\n`), token);
  assert.equal(verificationToken(`<a href="${url}">Verify email</a>`), token);
});

test('private mail capture reads omit browser Origin and all application credentials', () => {
  assert.deepEqual(requestHeaders('http://capture:8025/api/v1/messages'), {});
  const jar = new Map([['session', 'synthetic-private-cookie']]);
  assert.deepEqual(requestHeaders('http://localhost:3000/api/auth/csrf', { jar }), {
    origin: 'https://sign.codexdentist.com', cookie: 'session=synthetic-private-cookie',
  });
  for (const options of [{ jar }, { token: 'synthetic-private-api' }, { body: { password: 'synthetic' } }]) {
    assert.throws(() => requestHeaders('http://capture:8025/api/v1/messages', options));
  }
  assert.throws(() => requestHeaders('https://foreign.example/api'));
});

test('foreign origins, altered token shapes and unsupported link contracts are refused', () => {
  const token = 'b'.repeat(40);
  for (const url of [
    `http://sign.codexdentist.com/verify-email/${token}`,
    `https://sign.codexdentist.com.evil.test/verify-email/${token}`,
    `https://evil.test/https://sign.codexdentist.com/verify-email/${token}`,
    `https://sign.codexdentist.com/verify-email?token=${token}`,
    `https://sign.codexdentist.com/verify-email/${token}?forward=foreign`,
    `https://sign.codexdentist.com/verify-email/${token}#fragment`,
    `https://sign.codexdentist.com/verify-email/${'b'.repeat(39)}`,
    `https://sign.codexdentist.com/verify-email/${'z'.repeat(40)}`,
  ]) assert.equal(verificationToken(url), null, url);
});

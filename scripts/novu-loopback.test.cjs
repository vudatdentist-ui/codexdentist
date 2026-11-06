const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { load } = require('./audit-source-loader.cjs');

test('loopback Novu protocol: exact routes/auth, fixed payload, lost response and authenticated message lookup', async () => {
  const secret = 'loopback-synthetic-novu-key'; let posts = 0, transaction, loseResponse = false;
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1'); calls.push(`${request.method} ${url.pathname}`);
    const reply = body => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.headers.authorization !== `ApiKey ${secret}`) { response.writeHead(401); return response.end(); }
    if (request.method === 'GET' && url.pathname === '/v1/environments') return reply({ data: [{ _id: 'env', _organizationId: 'novu-org', identifier: 'app', apiKeys: [{ key: secret }] }] });
    if (request.method === 'GET' && url.pathname === '/v2/workflows/generic-notice') return reply({ data: { _id: 'workflow', workflowId: 'generic-notice', active: true, status: 'ACTIVE', steps: [{ type: 'email' }] } });
    if (request.method === 'GET' && url.pathname === '/v1/integrations/active') return reply([{ _environmentId: 'env', channel: 'email', providerId: 'nodemailer', active: true }]);
    if (request.method === 'GET' && url.pathname === '/v2/subscribers/cdx-test-operator') return reply({ data: { _id: 'subscriber', subscriberId: 'cdx-test-operator', _environmentId: 'env', email: 'operator@example.test', data: { codexdentistSynthetic: true } } });
    if (request.method === 'POST' && url.pathname === '/v1/events/trigger') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); posts++; transaction = body.transactionId;
      assert.equal(body.to, 'cdx-test-operator'); assert.equal(body.name, 'generic-notice');
      assert.deepEqual(body.payload, { kind: 'operator-test', version: 1 });
      assert.equal(request.headers['idempotency-key'], transaction);
      if (loseResponse) return request.socket.destroy();
      return reply({ data: { acknowledged: true, status: 'processed', transactionId: transaction } });
    }
    if (request.method === 'GET' && url.pathname === '/v1/messages') {
      assert.equal(url.searchParams.get('transactionId'), transaction);
      assert.equal(url.searchParams.get('channel'), 'email');
      return reply({ hasMore: false, data: [{ transactionId: transaction, _environmentId: 'env', _subscriberId: 'subscriber', _templateId: 'workflow', channel: 'email', status: 'sent' }] });
    }
    response.writeHead(404); response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const secrets = { baseUrl: origin, apiKey: secret, environmentId: 'env', workflowId: 'generic-notice', testSubscriberId: 'cdx-test-operator', deliveryChannel: 'email' };
  const transport = load('src/integrations/optional-http.ts', {}, { fetch, Headers, Response,
    process: { env: { OPTIONAL_PROVIDER_ALLOWED_ORIGINS: origin } } });
  const api = load('src/integrations/novu/client.ts', { '@/integrations/optional-http': transport });
  try {
    assert.equal((await api.verifyNovuConnection(secrets)).identity, 'novu-org/env/app');
    await api.triggerNovu(secrets, { subscriberId: secrets.testSubscriberId, transactionId: 'synthetic-tx', synthetic: true });
    loseResponse = true;
    await assert.rejects(api.triggerNovu(secrets, { subscriberId: secrets.testSubscriberId, transactionId: 'lost-tx', synthetic: true }), { code: 'novu-request-uncertain' });
    assert.equal(await api.observeNovuDelivery(secrets, { transactionId: 'lost-tx', subscriberDatabaseId: 'subscriber', workflowDatabaseId: 'workflow' }), 'SENT');
    assert.equal(posts, 2); assert.ok(calls.includes('GET /v1/messages'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

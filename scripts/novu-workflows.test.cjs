const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const secrets = { baseUrl: 'https://novu.example.test', apiKey: 'synthetic-secret-key', environmentId: 'env-A', workflowId: 'generic-notice', testSubscriberId: 'cdx-test-operator' };
const workflow = { _id: 'workflow-db', workflowId: secrets.workflowId, active: true, status: 'ACTIVE', steps: [{ type: 'email' }] };
const smtp = { _id: 'smtp', _environmentId: 'env-A', channel: 'email', providerId: 'nodemailer', active: true };
const subscriber = { _id: 'subscriber-db', subscriberId: secrets.testSubscriberId, _environmentId: 'env-A', email: 'synthetic@example.test', data: { codexdentistSynthetic: true } };
const response = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
function adapterHarness(reply, integrations = [smtp]) {
  const requests = [];
  const api = load('src/integrations/novu/client.ts', { '@/integrations/optional-http': { optionalProviderFetch: async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.headers.Authorization, `ApiKey ${secrets.apiKey}`);
    if (new URL(url).pathname === '/v1/integrations/active') return response(integrations);
    return reply(new URL(url), init);
  } } });
  return { api, requests };
}
test('verifier proves environment/key identity, active workflow and explicit marked test subscriber', async () => {
  const h = adapterHarness(url => url.pathname === '/v1/environments' ? response([{ _id: 'env-A', _organizationId: 'provider-org', identifier: 'app-id', apiKeys: [{ key: secrets.apiKey }] }])
    : url.pathname.startsWith('/v2/workflows') ? response(workflow) : response(subscriber));
  assert.deepEqual(plain(await h.api.verifyNovuConnection(secrets)), { identity: 'provider-org/env-A/app-id' });
  assert.equal(h.requests.length, 4);
  for (const change of [{ baseUrl: 'https://user:password@novu.example.test' }, { baseUrl: 'https://novu.example.test/path' }, { apiKey: 'a\nb' }, { testSubscriberId: 'patient-real' }]) {
    await assert.rejects(h.api.verifyNovuConnection({ ...secrets, ...change }));
  }
  assert.equal(h.requests.length, 4);
});
test('successful HTTP is insufficient: wrong environment/key, inactive/multi-channel workflow and real recipient fail', async () => {
  for (const env of [[{ _id: 'env-B', apiKeys: [{ key: secrets.apiKey }] }], [{ _id: 'env-A', apiKeys: [{ key: 'other-key' }] }], []]) {
    const h = adapterHarness(() => response(env));
    await assert.rejects(h.api.verifyNovuConnection(secrets), { code: 'novu-environment-mismatch' });
  }
  for (const changed of [{ ...workflow, active: false }, { ...workflow, steps: [{ type: 'email' }, { type: 'sms' }] }, { ...workflow, agent: { id: 'agent' } }]) {
    const h = adapterHarness(() => response(changed));
    await assert.rejects(h.api.verifyNovuWorkflow(secrets), { code: 'novu-workflow-not-supported' });
  }
  for (const changed of [{ ...subscriber, email: 'real@clinic.test' }, { ...subscriber, data: {} }, { ...subscriber, _environmentId: 'env-B' }]) {
    const h = adapterHarness(() => response(changed));
    await assert.rejects(h.api.verifyNovuSyntheticSubscriber(secrets));
  }
});
test('free-only contract rejects Novu Cloud, paid/free-tier email integrations, deleted subscribers and workflow errors', async () => {
  for (const host of ['https://api.novu.co', 'https://eu.api.novu.co']) {
    const h = adapterHarness(() => response({}));
    await assert.rejects(h.api.verifyNovuConnection({ ...secrets, baseUrl: host }), { code: 'novu-self-host-required' });
    assert.equal(h.requests.length, 0);
  }
  for (const integrations of [[], [{ ...smtp, providerId: 'resend' }], [{ ...smtp, providerId: 'sendgrid' }], [smtp, { ...smtp, _id: 'second-smtp' }], [{ ...smtp, _environmentId: 'env-B' }]]) {
    const h = adapterHarness(() => response(workflow), integrations);
    await assert.rejects(h.api.verifyNovuWorkflow(secrets), { code: 'novu-self-hosted-smtp-required' });
  }
  await assert.rejects(adapterHarness(() => response({ ...workflow, status: 'ERROR' })).api.verifyNovuWorkflow(secrets), { code: 'novu-workflow-not-supported' });
  await assert.rejects(adapterHarness(() => response({ ...subscriber, deleted: true })).api.verifyNovuSyntheticSubscriber(secrets), { code: 'novu-subscriber-mismatch' });
});
test('trigger uses opaque subscriber, transaction and idempotency header with fixed minimized payload', async () => {
  const h = adapterHarness((_url, init) => response({ acknowledged: true, status: 'processed', transactionId: JSON.parse(init.body).transactionId }));
  await h.api.triggerNovu(secrets, { subscriberId: 'cdx-sub-opaque', transactionId: 'opaque-transaction', synthetic: false });
  const request = h.requests[0];
  assert.equal(request.url, `${secrets.baseUrl}/v1/events/trigger`);
  assert.equal(request.init.headers['Idempotency-Key'], 'opaque-transaction');
  assert.deepEqual(JSON.parse(request.init.body), { name: secrets.workflowId, to: 'cdx-sub-opaque', transactionId: 'opaque-transaction', payload: { kind: 'notification', version: 1 } });
  for (const body of [{ acknowledged: false, status: 'processed', transactionId: 'x' }, { acknowledged: true, status: 'trigger_not_active', transactionId: 'x' }, { acknowledged: true, status: 'processed', transactionId: 'wrong' }]) {
    const bad = adapterHarness(() => response(body));
    await assert.rejects(bad.api.triggerNovu(secrets, { subscriberId: 'cdx-sub-opaque', transactionId: 'x', synthetic: false }), { code: 'novu-trigger-not-confirmed' });
  }
});
test('reconciliation requires exact message/subscriber/environment/workflow/channel plus sent status', async () => {
  const message = { transactionId: 'tx', _environmentId: 'env-A', _subscriberId: 'subscriber-db', _templateId: 'workflow-db', channel: 'email', status: 'sent' };
  const input = { transactionId: 'tx', subscriberDatabaseId: 'subscriber-db', workflowDatabaseId: 'workflow-db' };
  for (const [rows, expected] of [[[message], 'SENT'], [[], 'PENDING'], [[message, message], 'PENDING'], [[{ ...message, status: 'error' }], 'PENDING']]) {
    const h = adapterHarness(url => { assert.equal(url.searchParams.get('transactionId'), 'tx'); return response(rows); });
    assert.equal(await h.api.observeNovuDelivery(secrets, input), expected);
  }
  for (const changed of [{ transactionId: 'wrong' }, { _environmentId: 'other' }, { _subscriberId: 'other' }, { _templateId: 'other' }, { channel: 'sms' }]) {
    const h = adapterHarness(() => response([{ ...message, ...changed }]));
    await assert.rejects(h.api.observeNovuDelivery(secrets, input), { code: 'novu-message-mismatch' });
  }
});

function deliveryHarness(options = {}) {
  const references = new Map(); let sends = 0, reads = 0, canonical = options.canonical;
  const scope = { organizationId: 'org-A', clinicId: 'clinic-A' };
  const connection = { id: 'connection', ...scope, provider: 'novu', status: 'ACTIVE', updatedAt: new Date(1), lastVerifiedAt: new Date(1),
    metadata: { configurationVersion: 'version-A', verifiedVersion: 'version-A', providerIdentity: 'provider-org/env-A/app' } };
  const loaded = { connection, secrets };
  const db = {
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('FROM "IntegrationConnection"')) return [connection];
      if (sql.includes('INSERT INTO "ExternalReference"')) {
        const [id, organizationId, clinicId, connectionId, internalId, externalId, metadata] = args;
        const row = { id, organizationId, clinicId, connectionId, provider: 'novu', entityType: 'NOVU_DELIVERY', internalId, externalId, metadata: JSON.parse(metadata) };
        references.set(id, row); return [row];
      }
      if (sql.includes('"entityType"=\'NOVU_SUBSCRIBER\'')) return options.mapping ? [options.mapping] : [];
      const row = references.get(args[0]); return row && row.organizationId === args[1] && row.clinicId === args[2] ? [row] : [];
    },
    $executeRawUnsafe: async (sql, ...args) => {
      const row = references.get(args[0]);
      if (!row || row.organizationId !== args[1] || row.clinicId !== args[2]) return 0;
      if (row.metadata.state !== 'SENT') row.metadata.state = sql.includes("'{state}','\"SENT\"'") ? 'SENT' : args[3];
      return 1;
    },
    notification: { findFirst: async () => canonical, updateMany: async ({ where, data }) => { assert.equal(where.status, 'PROCESSING'); canonical.status = data.status; return { count: 1 }; } },
    patient: { findFirst: async () => options.patient ?? { id: 'patient', email: 'patient@example.test' } },
  };
  // Serial execution models transaction I/O here; the native runner separately
  // proves serialization/constraints with real PostgreSQL.
  let tail = Promise.resolve();
  const mocks = { '@/lib/prisma': { prisma: db }, '@/lib/transaction': { runSerializableTransaction: op => {
    const result = tail.then(() => op(db)); tail = result.catch(() => {}); return result;
  } }, '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnectionForScope: async () => { reads++; return loaded; } },
  '@/integrations/novu/client': { ...adapterHarness(() => response({})).api, verifyNovuWorkflow: async () => ({ workflowDatabaseId: 'workflow-db' }),
    verifyNovuSubscriber: async () => ({ subscriberDatabaseId: 'subscriber-db' }), verifyNovuSyntheticSubscriber: async () => ({ subscriberDatabaseId: 'test-db' }),
    triggerNovu: async () => { sends++; if (options.triggerError) throw options.triggerError; }, observeNovuDelivery: async () => options.observation ?? 'PENDING' } };
  const api = load('src/lib/application/integrations/novu-delivery.ts', mocks);
  return { api, scope, loaded, references, db, mocks, stats: () => ({ sends, reads }), setCanonical: value => { canonical = value; } };
}
test('persist-before-send, concurrent same intent, accepted and ambiguous-timeout replays never trigger twice', async () => {
  for (const triggerError of [undefined, new Error('private provider response')]) {
    const h = deliveryHarness({ triggerError });
    const input = { internalId: 'notification', subscriberId: 'cdx-sub-opaque', synthetic: false, expectedEmail: 'patient@example.test' };
    const results = await Promise.all(Array.from({ length: 4 }, () => h.api.sendNovuDelivery(h.scope, h.loaded, input)));
    assert.equal(h.stats().sends, 1); assert.equal(h.references.size, 1);
    assert.equal(results.filter(r => !r.duplicate).length, 1);
    const stored = [...h.references.values()][0];
    assert.equal(stored.metadata.state, triggerError ? 'UNCERTAIN' : 'ACCEPTED');
    assert.doesNotMatch(JSON.stringify(stored.metadata), /patient@example|private|synthetic-secret/);
    await h.api.sendNovuDelivery(h.scope, h.loaded, input); assert.equal(h.stats().sends, 1);
    assert.equal((await h.api.reconcileNovuDelivery(h.scope, h.loaded, stored.id)).state, stored.metadata.state);
    assert.equal(h.stats().sends, 1);
  }
});
test('authenticated sent observation settles canonical PROCESSING notification; changed scope/key cannot reconcile', async () => {
  const canonical = { status: 'PROCESSING' };
  const h = deliveryHarness({ observation: 'SENT', canonical });
  const sent = await h.api.sendNovuDelivery(h.scope, h.loaded, { internalId: 'notification', subscriberId: 'cdx-sub-opaque', synthetic: false });
  await assert.rejects(h.api.reconcileNovuDelivery({ ...h.scope, organizationId: 'org-B' }, h.loaded, sent.id), { code: 'novu-delivery-not-found' });
  await assert.rejects(h.api.reconcileNovuDelivery(h.scope, { ...h.loaded, secrets: { ...secrets, environmentId: 'changed-environment' } }, sent.id), { code: 'novu-connection-changed' });
  assert.equal(canonical.status, 'PROCESSING');
  assert.equal((await h.api.reconcileNovuDelivery(h.scope, { ...h.loaded, secrets: { ...secrets, apiKey: 'rotated-verified-key' } }, sent.id)).state, 'SENT');
  assert.equal(canonical.status, 'SENT'); assert.equal(h.stats().sends, 1);
});
test('worker reloads canonical claim and excludes credentials/unsupported/mismatched recipient before credentials or provider send', async () => {
  const h = deliveryHarness();
  const base = { id: 'n', ...h.scope, patientId: 'patient', channel: 'EMAIL', recipient: 'patient@example.test', status: 'PROCESSING', templateKey: null };
  for (const canonical of [null, { ...base, channel: 'SMS' }, { ...base, templateKey: 'PASSWORD_RESET' }, { ...base, patientId: null }]) {
    h.setCanonical(canonical); await assert.rejects(h.api.deliverNotificationToNovu(base));
  }
  assert.deepEqual(h.stats(), { sends: 0, reads: 0 });
  h.setCanonical({ ...base, recipient: 'another@example.test' });
  await assert.rejects(h.api.deliverNotificationToNovu(base), { code: 'novu-recipient-mismatch' });
  assert.equal(h.stats().sends, 0);
});
test('operator denies roles, demos, cross-clinic and missing explicit patient before loading keys', async () => {
  let keys = 0;
  const h = deliveryHarness();
  const api = load('src/lib/application/integrations/novu-operator.ts', { ...h.mocks,
    '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnection: async () => { keys++; return h.loaded; } },
  });
  const session = { role: 'OWNER', roles: ['OWNER'], roleAssignments: [{ role: 'OWNER', organizationId: 'org-A', clinicId: null }],
    clinicIds: ['clinic-A'], activeClinicId: null, organizationId: 'org-A', isDemo: false };
  for (const [s, clinic, code] of [[{ ...session, role: 'DENTIST', roles: ['DENTIST'], roleAssignments: [{ role: 'DENTIST', organizationId: 'org-A', clinicId: 'clinic-A' }] }, 'clinic-A', 'forbidden'], [{ ...session, isDemo: true }, 'clinic-A', 'novu-demo-unavailable'], [session, 'clinic-B', 'integration-clinic-forbidden']]) {
    await assert.rejects(api.runNovuOperatorCommand(s, { clinicId: clinic, action: 'test' }), { code });
  }
  assert.equal(keys, 0); assert.equal(h.stats().sends, 0);
});
test('reservation checks configuration and verified versions even when timestamps are identical', async () => {
  const h = deliveryHarness();
  const captured = { ...h.loaded, connection: { ...h.loaded.connection, metadata: { ...h.loaded.connection.metadata } } };
  for (const metadata of [{ configurationVersion: 'version-B', verifiedVersion: 'version-B', providerIdentity: 'provider-org/env-A/app' },
    { configurationVersion: 'version-A', verifiedVersion: 'older', providerIdentity: 'provider-org/env-A/app' },
    { configurationVersion: 'version-A', verifiedVersion: 'version-A', providerIdentity: 'different-account' }]) {
    h.loaded.connection.metadata = metadata;
    await assert.rejects(h.api.novuLockConnection(h.db, h.scope, captured), { code: 'novu-connection-changed' });
  }
  assert.equal(h.stats().sends, 0);
});
test('real route rejects unauthenticated, cross-origin, malformed/oversized and arbitrary recipient input', async () => {
  let session = null, dispatched = 0;
  const client = adapterHarness(() => response({})).api;
  const route = load('src/app/api/integrations/novu/operator/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/auth': { getSession: async () => session },
    '@/lib/env': { trustedProxyProvider: () => 'none' },
    '@/integrations/novu/client': client,
    '@/lib/application/integrations/novu-operator': { runNovuOperatorCommand: async () => { dispatched++; return {}; }, getNovuOperatorWorkspace: async () => ({}) },
  });
  const req = (body, origin = 'https://app.test') => new Request('https://app.test/api/integrations/novu/operator', { method: 'POST', headers: { origin, host: 'app.test' }, body });
  assert.equal((await route.GET(new Request('https://app.test'))).status, 401);
  assert.equal((await route.POST(req('{}'))).status, 401);
  session = { userId: 'owner' };
  assert.equal((await route.POST(req('{}', 'https://evil.test'))).status, 403);
  for (const body of ['{', 'null', '[]', JSON.stringify({ action: 'test', recipient: 'patient@example.test' })]) assert.equal((await route.POST(req(body))).status, 400);
  assert.equal((await route.POST(req('x'.repeat(5000)))).status, 413);
  assert.equal(dispatched, 0);
  const ok = await route.POST(req('{"action":"test","clinicId":"clinic-A"}'));
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('cache-control'), 'no-store'); assert.equal(dispatched, 1);
});

module.exports = { secrets, workflow, subscriber, deliveryHarness };

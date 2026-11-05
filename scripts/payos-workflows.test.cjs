const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

test('merchant resolution binds environment merchants to one organization and stored merchants to authenticated scope', async () => {
  let environmentCalls = 0, scope;
  const api = load('src/app/api/integrations/payos/connection-secrets.ts', {
    '@/lib/prisma': { prisma: {} },
    '@/infrastructure/integrations/credential-vault': { readIntegrationSecrets: async (_db, value) => { scope = value; return { clientId: 'c', apiKey: 'a', checksumKey: 'k' }; } },
    '@/integrations/config': { IntegrationConfigurationError: class extends Error { constructor(code) { super(code); this.code = code; } },
      payOSBaseUrl: () => 'https://merchant.test', resolvePayOSConnectionSecrets: () => { environmentCalls++; return { clientId: 'environment' }; } },
  }, { process: { env: { PAYOS_DEFAULT_ORGANIZATION_ID: 'A' } } });
  await assert.rejects(api.payOSConnectionSecrets({ id: 'c', provider: 'payos', organizationId: 'B', secretRef: 'env:PAYOS_DEFAULT' }), { code: 'payos-connection-not-configured' });
  assert.equal(environmentCalls, 0);
  assert.equal((await api.payOSConnectionSecrets({ id: 'c', provider: 'payos', organizationId: 'A', secretRef: 'env:PAYOS_DEFAULT' })).clientId, 'environment');
  await api.payOSConnectionSecrets({ id: 'stored', provider: 'payos', organizationId: 'B', secretRef: 'vault:v1' });
  assert.deepEqual(JSON.parse(JSON.stringify(scope)), { connectionId: 'stored', organizationId: 'B', provider: 'payos' });
  await assert.rejects(api.payOSConnectionSecrets({ id: 'c', provider: 'documenso', organizationId: 'A' }), { code: 'payos-connection-not-configured' });
});

test('bounded settings/payment body accepts only small object JSON', async () => {
  const { payOSRequestBody } = load('src/app/api/integrations/payos/http.ts', { 'next/server': { NextResponse: Response } });
  const request = value => new Request('https://app.test', { method: 'POST', body: value });
  assert.equal((await payOSRequestBody(request('{"action":"save"}'))).action, 'save');
  for (const value of ['null', '[]', '{', JSON.stringify({ key: 'x'.repeat(9000) })]) {
    await assert.rejects(payOSRequestBody(request(value)), { code: 'payos-input-invalid', status: 400 });
  }
});

function settingsHarness() {
  const connection = { id: 'connection', organizationId: 'A', clinicId: 'clinic', provider: 'payos', status: 'ACTIVE', secretRef: 'vault:v1', metadata: {}, lastVerifiedAt: null };
  let reads = 0, writes = 0;
  const tx = { $queryRawUnsafe: async () => { reads++; return [connection]; }, auditLog: { create: async () => { writes++; } } };
  const api = load('src/lib/application/integrations/payos-settings.ts', {
    '@/lib/prisma': { prisma: {} }, '@/lib/env': { appBaseUrl: () => 'https://app.test' },
    '@/lib/actions/permissions': { canPerformAction: session => session.allowed },
    '@/lib/permissions': { hasAnyRole: (session, roles) => roles.includes(session.role) },
    '@/lib/tenant-scope': { accessibleClinicIds: session => session.clinicIds },
    '@/lib/transaction': { runSerializableTransaction: operation => operation(tx) },
    '@/infrastructure/integrations/credential-vault': { writeIntegrationSecrets: async () => { writes++; } },
    '@/infrastructure/integrations/substrate': { upsertIntegrationConnection: async () => { writes++; return connection; } },
    '@/infrastructure/integrations/payos-workspace-store': { hasUnresolvedPayOSOrders: async () => true,
      payOSConnections: async () => [connection], payOSConnectionSummary: value => ({ id: value.id }) },
  });
  const session = { allowed: true, role: 'CLINIC_MANAGER', organizationId: 'A', clinicIds: ['clinic'], clinics: [{ id: 'clinic', name: 'Synthetic' }] };
  return { api, session, stats: () => ({ reads, writes }) };
}
test('settings commands deny roles, demo and inaccessible/global clinic scope before persistence', async () => {
  const h = settingsHarness();
  await assert.rejects(h.api.getPayOSSettings({ ...h.session, allowed: false }), { code: 'forbidden' });
  for (const [session, clinicId, code] of [
    [{ ...h.session, isDemo: true }, 'clinic', 'payos-demo-unavailable'],
    [h.session, 'other-clinic', 'integration-clinic-forbidden'], [h.session, null, 'integration-clinic-forbidden'],
  ]) await assert.rejects(h.api.savePayOSSettings(session, { action: 'disable', clinicId }), { code });
  assert.deepEqual(h.stats(), { reads: 0, writes: 0 });
});
test('unresolved payments block key replacement/disable but permit recovery by enabling the same connection', async () => {
  const h = settingsHarness();
  for (const body of [{ action: 'disable', clinicId: 'clinic' }, { action: 'save', clinicId: 'clinic',
    credentials: { clientId: 'synthetic-client', apiKey: 'a'.repeat(64), checksumKey: 'k'.repeat(64) } }]) {
    await assert.rejects(h.api.savePayOSSettings(h.session, body), { code: 'payos-orders-unresolved', status: 409 });
  }
  assert.equal(h.stats().writes, 0);
  await h.api.savePayOSSettings(h.session, { action: 'enable', clinicId: 'clinic' });
  assert.equal(h.stats().writes, 2);
});

test('settled payment-intent replay returns the original order without requiring a positive invoice balance again', async () => {
  const connection = { id: 'connection', organizationId: 'A', clinicId: 'clinic', provider: 'payos', status: 'ACTIVE', secretRef: 'vault:v1',
    metadata: { webhookConfirmed: true }, lastVerifiedAt: new Date() };
  const reference = { id: 'order', externalId: '1234', metadata: { patientId: 'patient', amount: 100000, invoiceNo: 'INV', status: 'SETTLED', checkoutUrl: 'https://pay.test/order' } };
  let existing = reference;
  const tx = { $queryRawUnsafe: async (sql, ...params) => {
    if (sql.includes('FROM "Invoice"')) return [{ amount: 100000, paidAmount: 0, status: 'OPEN' }];
    assert.ok(sql.includes('FOR UPDATE') && sql.includes('IntegrationConnection'));
    assert.deepEqual(params, ['connection', 'A']); return [connection];
  } };
  const api = load('src/lib/application/integrations/payos-orders.ts', {
    '@/lib/prisma': { prisma: { patient: { findFirst: async () => ({ id: 'patient', clinicId: 'clinic' }) } } },
    '@/lib/actions/permissions': { canPerformAction: () => true }, '@/lib/tenant-scope': { accessibleClinicIds: () => ['clinic'] },
    '@/lib/transaction': { runSerializableTransaction: operation => operation(tx) },
    '@/infrastructure/integrations/substrate': { createExternalReference: async (_tx, input) => ({ id: 'fresh-order', externalId: input.externalId, metadata: input.metadata }) },
    '@/infrastructure/integrations/phase3-store': { findActiveIntegrationConnection: async () => connection,
      getExternalReferenceByInternalId: async () => existing, referenceMetadata: row => row.metadata },
    '@/infrastructure/integrations/payos-workspace-store': { payOSConnectionSummary: () => ({ verified: true }) },
  });
  const input = { patientId: 'patient', invoiceNo: 'INV', amount: 100000, idempotencyKey: 'same-intent' };
  const result = await api.reservePayOSOrder({ organizationId: 'A' }, input, async (_connection, client) => { assert.equal(client, tx); return {}; });
  assert.equal(result.duplicate, true); assert.equal(result.intent, reference);
  await assert.rejects(api.reservePayOSOrder({ organizationId: 'A' }, { ...input, amount: 1 }, async () => ({})), { code: 'payos-idempotency-key-conflict' });
  existing = null;
  const fresh = await api.reservePayOSOrder({ organizationId: 'A' }, { ...input, idempotencyKey: 'new-intent' }, async () => ({}));
  assert.equal(fresh.duplicate, false, 'The real substrate returns a plain newly created record, with no created marker');
  assert.equal(fresh.intent.id, 'fresh-order');
});

test('only the authenticated documented provider sample matches the verification probe contract', () => {
  const { payOSVerificationProbe, payOSCheckoutUrl } = load('src/features/integrations/payos-workspace.ts');
  const sample = { success: true, data: { orderCode: 123, amount: 3000, description: 'VQRIO123', reference: 'TF230204212323', paymentLinkId: '124c33293c43417ab7879e14c8d9eb18' } };
  assert.equal(payOSVerificationProbe(sample), true);
  for (const change of [{ orderCode: 124 }, { amount: 3001 }, { description: 'other' }, { reference: 'other' }, { paymentLinkId: 'other' }]) assert.equal(payOSVerificationProbe({ ...sample, data: { ...sample.data, ...change } }), false);
  assert.equal(payOSVerificationProbe({ ...sample, success: false }), false);
  for (const value of ['javascript:alert(1)', 'http://pay.test', 'https://user:password@pay.test', 'data:text/html,unsafe']) assert.equal(payOSCheckoutUrl(value), null);
  assert.equal(payOSCheckoutUrl('https://pay.test/order'), 'https://pay.test/order');
});

test('inbox backoff follows the database clock even when the app clock disagrees', async () => {
  let ready = true, invoked = 0;
  const tx = { $queryRawUnsafe: async sql => {
    assert.ok(sql.includes('clock_timestamp()') && sql.includes('AS "ready"'));
    return [{ id: 'event', organizationId: 'A', status: 'RECEIVED',
      availableAt: new Date('2099-01-01'), ready }];
  }, $executeRawUnsafe: async () => 1 };
  const { processIntegrationInbox } = load('src/infrastructure/integrations/substrate.ts');
  const db = { $transaction: operation => operation(tx) };
  assert.equal((await processIntegrationInbox(db, 'event', async () => { invoked++; })).status, 'processed');
  ready = false;
  assert.equal((await processIntegrationInbox(db, 'event', async () => { invoked++; })).status, 'retry_pending');
  assert.equal(invoked, 1);
});

test('inbox retry scheduling adds its delay to the database clock rather than an app timestamp', async () => {
  let schedule;
  const db = { $transaction: async () => { throw Object.assign(new Error('synthetic'), { code: 'synthetic' }); },
    $queryRawUnsafe: async (sql, ...params) => { schedule = { sql, params }; return []; } };
  const { processIntegrationInbox } = load('src/infrastructure/integrations/substrate.ts');
  await assert.rejects(processIntegrationInbox(db, 'event', async () => {}, { retryDelayMs: 5000 }), { code: 'synthetic' });
  assert.ok(schedule.sql.includes("clock_timestamp() AT TIME ZONE 'UTC'") && schedule.sql.includes("interval '1 millisecond'"));
  assert.equal(schedule.params[2], 5000);
});

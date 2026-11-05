const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { load } = require('./audit-source-loader.cjs');

// Independent response-signature oracle, including array item key ordering.
function signature(data, key = 'synthetic-checksum') {
  const sorted = value => Object.fromEntries(Object.keys(value).sort().map(name => [name, value[name]]));
  const value = item => item == null || item === 'null' || item === 'undefined' ? ''
    : Array.isArray(item) ? JSON.stringify(item.map(row => row && typeof row === 'object' ? sorted(row) : row))
      : typeof item === 'object' ? JSON.stringify(sorted(item)) : String(item);
  return createHmac('sha256', key).update(Object.keys(data).sort().map(name => `${name}=${value(data[name])}`).join('&')).digest('hex');
}

function fixture(options = {}) {
  let session = { organizationId: 'org-A', userId: 'owner', role: 'OWNER', roles: ['OWNER'], isDemo: false,
    clinicIds: ['clinic-A'], clinics: [{ id: 'clinic-A', name: 'Synthetic clinic' }], activeClinicId: null };
  const connection = { id: 'original-connection', organizationId: 'org-A', clinicId: 'clinic-A', provider: 'payos',
    status: 'ACTIVE', secretRef: 'vault:v1', metadata: { webhookConfirmed: true }, lastVerifiedAt: new Date() };
  const patient = { id: 'patient-A', organizationId: 'org-A', clinicId: 'clinic-A' };
  const order = { id: 'local-order', organizationId: 'org-A', clinicId: 'clinic-A', connectionId: connection.id,
    provider: 'payos', entityType: 'PAYOS_ORDER', externalId: '178349999912345', internalId: 'same-intent',
    metadata: { status: 'ERROR', creationUncertain: true, patientId: patient.id, clinicId: patient.clinicId,
      amount: 100000, invoiceNo: 'INV-A', currency: 'VND', checkoutUrl: 'https://pay.payos.vn/checkout', qrCode: 'synthetic-qr',
      ...options.metadata } };
  const env = { NODE_ENV: 'production', PAYOS_DEFAULT_ORGANIZATION_ID: 'org-A',
    PAYOS_DEFAULT_CLIENT_ID: 'synthetic-client', PAYOS_DEFAULT_API_KEY: 'synthetic-access', PAYOS_DEFAULT_CHECKSUM_KEY: 'synthetic-checksum',
    PAYOS_DEFAULT_BASE_URL: 'https://merchant.test' };
  const secrets = { clientId: 'synthetic-client', apiKey: 'synthetic-access', checksumKey: 'synthetic-checksum' };
  const stats = { transactionDepth: 0, connectionLocked: false, orderLocked: false, financialTouches: 0,
    http: [], timeouts: [], secretReads: 0, updates: 0, audits: [], queries: [] };
  const copy = value => structuredClone(value);
  let duringHTTP, duringCreateHTTP, duringCreateAudit;
  const target = {
    patient: { findFirst: async ({ where }) => patient.id === where.id && patient.organizationId === where.organizationId && patient.clinicId === where.clinicId ? { id: patient.id } : null },
    auditLog: { create: async ({ data }) => {
      if (data.action === 'payos.payment_link_created') {
        assert.equal(stats.transactionDepth, 0);
        if (duringCreateAudit) await duringCreateAudit();
      } else assert.equal(stats.transactionDepth, 1);
      stats.audits.push(copy(data)); return data;
    } },
    $transaction: async operation => {
      assert.equal(stats.transactionDepth, 0);
      const saved = copy(order);
      stats.transactionDepth++; stats.connectionLocked = false; stats.orderLocked = false;
      try { return await operation(db); } catch (error) { Object.assign(order, saved); throw error; }
      finally { stats.transactionDepth--; stats.connectionLocked = false; stats.orderLocked = false; }
    },
    $queryRawUnsafe: async (sql, ...params) => {
      stats.queries.push({ sql, params });
      if (sql.includes('SELECT EXISTS')) {
        assert.deepEqual(params, [connection.id, 'org-A']);
        const statuses = [...sql.match(/NOT IN \(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
        return [{ unresolved: !statuses.includes(order.metadata.status ?? 'PENDING') }];
      }
      if (sql.includes('FROM "IntegrationConnection"')) {
        assert.match(sql, /FOR UPDATE/); assert.equal(stats.transactionDepth, 1);
        const valid = connection.id === params[0] && connection.organizationId === params[1] && connection.provider === 'payos' &&
          ['ACTIVE', 'DISABLED'].includes(connection.status) && (connection.clinicId === null || connection.clinicId === params[2]);
        if (valid) stats.connectionLocked = true;
        return valid ? [copy(connection)] : [];
      }
      if (sql.includes('FROM "ExternalReference"')) {
        if (sql.includes('"externalId" = $5')) {
          assert.deepEqual(params, ['org-A', connection.id, 'payos', 'PAYOS_ORDER', order.externalId]);
          return [copy(order)];
        }
        assert.match(sql, /"provider"='payos'/); assert.match(sql, /"entityType"='PAYOS_ORDER'/);
        if (sql.includes('FOR UPDATE')) { assert.ok(stats.connectionLocked); stats.orderLocked = true; }
        return order.id === params[0] && order.organizationId === params[1] && params[2].includes(order.clinicId) &&
          order.provider === 'payos' && order.entityType === 'PAYOS_ORDER' ? [copy(order)] : [];
      }
      if (sql.includes('UPDATE "ExternalReference"')) {
        assert.equal(params[0], order.id);
        const next = JSON.parse(params[1]);
        const originalGuard = sql.includes("IN ('SETTLED', 'SIGNED')") && sql.includes("NOT IN ('SETTLED', 'SIGNED')");
        const cancelledGuard = sql.includes('"provider"=\'payos\' AND "entityType"=\'PAYOS_ORDER\' AND "metadata"->>\'status\'=\'CANCELLED\'') && sql.includes("<> 'SETTLED'");
        const preserve = originalGuard && ['SETTLED', 'SIGNED'].includes(order.metadata.status) && !['SETTLED', 'SIGNED'].includes(next.status) ||
          cancelledGuard && order.provider === 'payos' && order.entityType === 'PAYOS_ORDER' && order.metadata.status === 'CANCELLED' && next.status !== 'SETTLED';
        stats.updates++; if (!preserve) order.metadata = next;
        return [copy(order)];
      }
      stats.financialTouches++; throw new Error(`Unexpected persistence statement: ${sql}`);
    },
  };
  const db = new Proxy(target, { get(object, key) {
    if (key in object) return object[key];
    stats.financialTouches++; throw new Error(`Unexpected database delegate: ${String(key)}`);
  } });
  const mocks = { 'next/server': { NextResponse: Response }, '@/lib/prisma': { prisma: db },
    '@/lib/auth': { getSession: async () => session },
    '@/lib/env': { trustedProxyProvider: () => 'none', appBaseUrl: () => 'https://app.test' },
    // The late-response cases begin after the existing reservation has committed.
    // The creation handler, provider client and metadata SQL helper remain real.
    '@/lib/application/integrations/payos-orders': { reservePayOSOrder: async () => ({
      intent: copy(order), secrets: { ...secrets, baseUrl: 'https://merchant.test' }, duplicate: false,
    }) },
    '@/infrastructure/integrations/credential-vault': { readIntegrationSecrets: async (_db, scope) => {
      assert.ok(stats.connectionLocked && stats.orderLocked, 'Decrypt only after locking the original connection and order');
      assert.deepEqual({ ...scope }, { organizationId: connection.organizationId, connectionId: connection.id, provider: 'payos' });
      stats.secretReads++; return { ...secrets };
    } } };
  const globals = { Request, Response, Headers, Date, process: { env },
    AbortSignal: { timeout: ms => { stats.timeouts.push(ms); return AbortSignal.timeout(ms); } },
    fetch: async (url, init) => {
      assert.equal(stats.transactionDepth, 0, 'Provider HTTP must be outside every transaction');
      if (init.method === 'POST') {
        assert.equal(url, 'https://merchant.test/v2/payment-requests');
        const body = JSON.parse(init.body);
        stats.http.push({ url, method: init.method });
        if (duringCreateHTTP) await duringCreateHTTP();
        const data = { orderCode: body.orderCode, amount: body.amount, currency: 'VND', paymentLinkId: 'provider-link-A',
          checkoutUrl: 'https://pay.payos.vn/stale', qrCode: 'stale-qr', status: 'PENDING' };
        return Response.json({ code: '00', data, signature: signature(data) });
      }
      assert.equal(url, `https://merchant.test/v2/payment-requests/${order.externalId}`);
      assert.equal(init.method, 'GET'); assert.equal(init.cache, 'no-store'); assert.equal(init.body, undefined);
      assert.equal(init.headers['x-client-id'], 'synthetic-client'); assert.equal(init.headers['x-api-key'], 'synthetic-access');
      assert.ok(init.signal instanceof AbortSignal);
      stats.http.push({ url, method: init.method });
      if (duringHTTP) await duringHTTP();
      if (options.timeout) throw new DOMException('synthetic-checksum private bank details', 'TimeoutError');
      const data = { id: 'provider-link-A', orderCode: Number(order.externalId), amount: 100000, amountPaid: 0, amountRemaining: 100000,
        status: 'CANCELLED', createdAt: '2026-11-05T01:00:00Z', transactions: [], ...options.data };
      return Response.json({ code: options.code ?? '00', desc: 'private provider text', data,
        ...(options.omitSignature ? {} : { signature: options.forgedSignature ? '0'.repeat(64) : signature(data) }) }, { status: options.httpStatus ?? 200 });
    } };
  const cache = new Map();
  const read = file => load(file, mocks, globals, cache);
  const route = read('src/app/api/integrations/payos/payment-links/[orderId]/reconcile/route.ts');
  const store = read('src/infrastructure/integrations/phase3-store.ts');
  return { order, connection, patient, env, secrets, stats,
    session: () => session, signOut: () => { session = null; }, duringHTTP: callback => { duringHTTP = callback; },
    duringCreate: callback => { duringCreateHTTP = callback; }, duringCreateAudit: callback => { duringCreateAudit = callback; },
    post: (id = order.id, origin = 'https://app.test', body) => route.POST(new Request(`https://app.test/api/integrations/payos/payment-links/${id}/reconcile`,
      { method: 'POST', headers: { host: 'app.test', origin, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve({ orderId: id }) }),
    unresolved: () => read('src/infrastructure/integrations/payos-workspace-store.ts').hasUnresolvedPayOSOrders(db, connection.id, 'org-A'),
    lateWrite: metadata => store.updateExternalReferenceMetadataWithRetry(db, order.id, metadata),
    createPost: () => read('src/app/api/integrations/payos/payment-links/route.ts').POST(new Request('https://app.test/api/integrations/payos/payment-links', {
      method: 'POST', headers: { host: 'app.test', origin: 'https://app.test', 'content-type': 'application/json' },
      body: JSON.stringify({ patientId: patient.id, invoiceNo: 'INV-A', amount: 100000, idempotencyKey: 'same-intent' }),
    })),
  };
}

test('lost-response ERROR plus signed cancelled-zero retires the order, removes QR and releases the real unresolved SQL guard', async () => {
  const h = fixture(); assert.equal(await h.unresolved(), true);
  const response = await h.post(); assert.equal(response.status, 200, await response.clone().text()); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await response.json(), { status: 'CANCELLED', providerStatus: 'CANCELLED', amountPaid: 0, changed: true });
  assert.equal(h.order.metadata.creationUncertain, false); assert.equal(h.order.metadata.qrCode, null); assert.equal(h.order.metadata.checkoutUrl, null);
  assert.equal(await h.unresolved(), false); assert.equal(h.stats.financialTouches, 0); assert.deepEqual(h.stats.timeouts, [20000]);
  assert.equal(typeof h.order.metadata.providerCheckedAt, 'string');
  assert.equal(h.stats.audits.length, 1); assert.deepEqual(Object.keys(h.stats.audits[0].metadata).sort(), ['clinicId', 'connectionId', 'previousStatus', 'providerStatus', 'status']);
  assert.equal(JSON.stringify(h.order.metadata).includes('transactions'), false);
});

test('signed expired-zero works through the original disabled connection, independently of current invoice/clock', async () => {
  const h = fixture({ data: { status: 'EXPIRED' } }); h.connection.status = 'DISABLED';
  const response = await h.post(); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'CANCELLED');
  assert.equal(h.stats.secretReads, 1); assert.equal(await h.unresolved(), false); assert.equal(h.stats.financialTouches, 0);
});

for (const data of [
  { status: 'PENDING' }, { status: 'PROCESSING' }, { status: 'FAILED' },
  { status: 'PAID', amountPaid: 100000, amountRemaining: 0 },
  { status: 'UNDERPAID', amountPaid: 30000, amountRemaining: 70000 },
  { status: 'CANCELLED', amountPaid: 1, amountRemaining: 99999 }, { status: 'EXPIRED', amountPaid: 30000, amountRemaining: 70000 },
]) test(`signed ${data.status} with paid ${data.amountPaid ?? 0} only records an observation and keeps credentials locked`, async () => {
  const h = fixture({ data }); const response = await h.post(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ERROR', providerStatus: data.status, amountPaid: data.amountPaid ?? 0, changed: false });
  assert.equal(h.order.metadata.status, 'ERROR'); assert.equal(h.order.metadata.creationUncertain, true);
  assert.equal(h.order.metadata.providerStatus, data.status); assert.equal(h.order.metadata.providerAmountPaid, data.amountPaid ?? 0);
  assert.equal(await h.unresolved(), true); assert.equal(h.stats.financialTouches, 0);
});

for (const options of [
  { forgedSignature: true }, { omitSignature: true }, { data: { orderCode: 12345 } }, { data: { amount: 99999 } },
  { data: { orderCode: '178349999912345' } }, { data: { id: 'different-provider-link' }, metadata: { paymentLinkId: 'provider-link-A' } },
  { data: { id: '' } }, { data: { amountPaid: -1 } }, { data: { amountPaid: 0.5 } }, { data: { amountPaid: '0' } },
  { data: { amountRemaining: -1 } }, { data: { amountRemaining: 1.5 } }, { data: { amountRemaining: Number.MAX_SAFE_INTEGER + 1 } },
  { data: { amountRemaining: 0 } }, { data: { status: 'PAID', amountPaid: 0 } },
  { data: { status: 'MIXED' } }, { data: { status: 'UNKNOWN' } }, { timeout: true }, { httpStatus: 404 }, { httpStatus: 401 }, { code: '231' },
]) test(`invalid/unconfirmed provider status cannot retire an order: ${JSON.stringify(options)}`, async () => {
  const h = fixture(options); const before = structuredClone(h.order.metadata);
  const response = await h.post(); assert.ok(response.status >= 400);
  assert.equal(h.stats.http.length, 1, 'Exercise the actual provider response validator rather than failing an earlier fixture boundary');
  const body = await response.text(); assert.doesNotMatch(body, /private|synthetic-checksum|bank details/);
  assert.deepEqual(h.order.metadata, before); assert.equal(h.stats.updates, 0); assert.equal(h.stats.audits.length, 0);
  assert.equal(await h.unresolved(), true); assert.equal(h.stats.financialTouches, 0);
});

test('known provider ID and HMAC over transactions validate without storing bank transaction details', async () => {
  const h = fixture({ metadata: { paymentLinkId: 'provider-link-A' }, data: { status: 'PAID', amountPaid: 100000, amountRemaining: 0,
    transactions: [{ reference: 'private-bank-reference', amount: 100000, accountNumber: 'private-bank-account', description: 'private-bank-description' }] } });
  assert.equal((await h.post()).status, 200);
  assert.doesNotMatch(JSON.stringify(h.order.metadata) + JSON.stringify(h.stats.audits), /private-bank/);
});

for (const status of ['SETTLED', 'CANCELLED', 'FAILED']) test(`already terminal ${status} skips credentials and provider HTTP even after merchant replacement`, async () => {
  const h = fixture({ metadata: { status } }); h.connection.secretRef = 'unavailable-replaced-merchant'; h.connection.organizationId = 'other-org';
  const response = await h.post(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status, providerStatus: null, amountPaid: null, changed: false });
  assert.equal(h.stats.secretReads, 0); assert.equal(h.stats.http.length, 0); assert.equal(h.stats.updates, 0);
});

for (const scenario of ['signed-out', 'role', 'demo', 'csrf', 'organization', 'clinic', 'patient', 'connection-org', 'connection-clinic', 'connection-provider', 'env-binding']) {
  test(`scope/auth guard ${scenario} prevents all provider HTTP`, async () => {
    const h = fixture(); let origin = 'https://app.test';
    if (scenario === 'signed-out') h.signOut();
    if (scenario === 'role') { h.session().role = 'DENTIST'; h.session().roles = ['DENTIST']; }
    if (scenario === 'demo') h.session().isDemo = true;
    if (scenario === 'csrf') origin = 'https://attacker.test';
    if (scenario === 'organization') h.order.organizationId = 'org-B';
    if (scenario === 'clinic') h.session().clinicIds = ['clinic-B'];
    if (scenario === 'patient') h.patient.organizationId = 'org-B';
    if (scenario === 'connection-org') h.connection.organizationId = 'org-B';
    if (scenario === 'connection-clinic') h.connection.clinicId = 'clinic-B';
    if (scenario === 'connection-provider') h.connection.provider = 'orthanc';
    if (scenario === 'env-binding') { h.connection.secretRef = 'env:PAYOS_DEFAULT'; h.env.PAYOS_DEFAULT_ORGANIZATION_ID = 'org-B'; }
    const response = await h.post(h.order.id, origin, { organizationId: 'org-A', clinicId: 'clinic-A' });
    assert.ok([401, 403, 404, 409, 503].includes(response.status));
    assert.equal(h.stats.http.length, 0); assert.equal(h.stats.updates, 0); assert.equal(h.stats.financialTouches, 0);
  });
}

test('a concurrently committed webhook SETTLED wins over the earlier signed cancellation snapshot', async () => {
  const h = fixture(); h.duringHTTP(() => { h.order.metadata = { ...h.order.metadata, status: 'SETTLED', receiptNo: 'RECEIPT-OWNED-BY-WEBHOOK' }; });
  const response = await h.post(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'SETTLED', providerStatus: null, amountPaid: null, changed: false });
  assert.equal(h.order.metadata.receiptNo, 'RECEIPT-OWNED-BY-WEBHOOK'); assert.equal(h.stats.updates, 0); assert.equal(h.stats.financialTouches, 0);
});

for (const status of ['PENDING', 'CANCELLED', 'EXPIRED']) test(`older signed ${status} zero-paid observation cannot erase already observed money`, async () => {
  const h = fixture({ data: { status } });
  h.duringHTTP(() => { h.order.metadata = { ...h.order.metadata, providerStatus: 'PAID', providerAmountPaid: 100000 }; });
  const response = await h.post(); assert.equal(response.status, 200);
  assert.equal(h.order.metadata.status, 'ERROR'); assert.equal(h.order.metadata.creationUncertain, true);
  assert.equal(h.order.metadata.providerAmountPaid, 100000); assert.equal(await h.unresolved(), true);
  assert.equal(h.stats.financialTouches, 0);
});

test('legacy signed PAID status without an amount stays unresolved across repeated zero-paid snapshots', async () => {
  const h = fixture({ metadata: { providerStatus: 'PAID' }, data: { status: 'CANCELLED' } });
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await h.post()).status, 200); assert.equal(h.order.metadata.status, 'ERROR');
    assert.equal(h.order.metadata.providerStatus, 'PAID'); assert.equal(await h.unresolved(), true);
  }
});

test('cancel-zero then key replacement cannot be undone by late creation success or failure; a verified settlement can still advance', async () => {
  const h = fixture(); const staleCreation = structuredClone(h.order.metadata);
  assert.equal((await h.post()).status, 200); assert.equal(await h.unresolved(), false);
  // Settings can now rotate; emulate only that independent credential write.
  h.secrets.clientId = 'replacement-merchant'; h.secrets.checksumKey = 'replacement-checksum';
  for (const status of ['PENDING', 'ERROR', 'FAILED', 'CREATING']) {
    const updated = await h.lateWrite({ ...staleCreation, status, checkoutUrl: 'https://pay.payos.vn/stale' });
    assert.equal(updated.metadata.status, 'CANCELLED'); assert.equal(updated.metadata.checkoutUrl, null);
    assert.equal(await h.unresolved(), false);
  }
  const replay = await h.post(); assert.equal((await replay.json()).status, 'CANCELLED'); assert.equal(h.stats.http.length, 1);
  const settled = await h.lateWrite({ ...h.order.metadata, status: 'SETTLED', receiptNo: 'VERIFIED-WEBHOOK' });
  assert.equal(settled.metadata.status, 'SETTLED');
  assert.equal((await h.lateWrite({ ...staleCreation, status: 'PENDING' })).metadata.status, 'SETTLED');
  assert.equal(h.stats.financialTouches, 0);
});

test('the added terminal guard is limited to payOS orders and retains existing SIGNED/SETTLED protection', async () => {
  const h = fixture();
  for (const status of ['SETTLED', 'SIGNED']) {
    h.order.metadata.status = status;
    assert.equal((await h.lateWrite({ status: 'PENDING' })).metadata.status, status);
  }
  h.order.provider = 'documenso'; h.order.metadata.status = 'CANCELLED';
  assert.equal((await h.lateWrite({ status: 'PENDING' })).metadata.status, 'PENDING');
  h.order.provider = 'payos'; h.order.entityType = 'OTHER_REFERENCE'; h.order.metadata.status = 'CANCELLED';
  assert.equal((await h.lateWrite({ status: 'PENDING' })).metadata.status, 'PENDING');
});

test('real creation route returns durable cancellation without stale QR after recovery and merchant rotation during its HTTP request', async () => {
  const h = fixture();
  h.duringCreate(async () => {
    assert.equal((await h.post()).status, 200); assert.equal(await h.unresolved(), false);
    h.secrets.clientId = 'replacement-merchant'; h.secrets.checksumKey = 'replacement-checksum';
  });
  const response = await h.createPost(); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { orderCode: Number(h.order.externalId), paymentLinkId: null,
    checkoutUrl: null, qrCode: null, status: 'CANCELLED', duplicate: true });
  assert.equal(h.order.metadata.status, 'CANCELLED'); assert.equal(await h.unresolved(), false);
  assert.equal(h.stats.http.length, 2); assert.equal(h.stats.financialTouches, 0);
});

test('real creation route returns durable SETTLED rather than its late provider PENDING response', async () => {
  const h = fixture();
  h.duringCreate(() => { h.order.metadata = { ...h.order.metadata, status: 'SETTLED', receiptNo: 'WEBHOOK-RECEIPT' }; });
  const response = await h.createPost(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.status, 'SETTLED'); assert.equal(body.checkoutUrl, null); assert.equal(body.qrCode, null);
  assert.equal(h.order.metadata.receiptNo, 'WEBHOOK-RECEIPT'); assert.equal(h.stats.financialTouches, 0);
});

test('real creation audit-failure catch cannot restore or return PENDING after recovery retires the persisted order', async () => {
  const h = fixture();
  h.duringCreateAudit(async () => {
    assert.equal((await h.post()).status, 200); assert.equal(await h.unresolved(), false);
    throw new Error('synthetic interrupted creation audit');
  });
  const response = await h.createPost(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.status, 'CANCELLED'); assert.equal(body.checkoutUrl, null); assert.equal(body.qrCode, null);
  assert.equal(h.order.metadata.status, 'CANCELLED'); assert.equal(await h.unresolved(), false); assert.equal(h.stats.financialTouches, 0);
});

test('successful creation audit cannot return a stale QR after recovery commits during that audit', async () => {
  const h = fixture(); h.duringCreateAudit(async () => { assert.equal((await h.post()).status, 200); });
  const response = await h.createPost(); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.status, 'CANCELLED'); assert.equal(body.checkoutUrl, null); assert.equal(body.qrCode, null);
});

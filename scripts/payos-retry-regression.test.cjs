const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');

// Exercise the checked-out routes, reservation, provider client and SQL helpers.
// Only authentication, transaction transport, SQL and HTTP I/O are simulated;
// these tests never connect to an app, provider or database.
function fixture({ outcomes = [], metadata, invoice = { amount: 100000, paidAmount: 0, status: 'OPEN' } } = {}) {
  const session = { organizationId: 'org-A', userId: 'owner', role: 'OWNER', isDemo: false,
    clinicIds: ['clinic-A'], clinics: [{ id: 'clinic-A', name: 'Synthetic clinic' }] };
  const connection = { id: 'connection-A', organizationId: session.organizationId, clinicId: 'clinic-A',
    provider: 'payos', status: 'ACTIVE', secretRef: 'vault:v1', lastVerifiedAt: new Date(),
    metadata: { webhookConfirmed: true } };
  const input = { patientId: 'patient-A', invoiceNo: 'INV-A', amount: 100000, idempotencyKey: 'same-payment-intent' };
  const orderMetadata = { ...input, clinicId: connection.clinicId, currency: 'VND', ...metadata };
  delete orderMetadata.idempotencyKey;
  let order = metadata ? { id: 'order-A', organizationId: session.organizationId, clinicId: connection.clinicId,
    connectionId: connection.id, provider: 'payos', entityType: 'PAYOS_ORDER', internalId: input.idempotencyKey,
    externalId: '123456', metadata: orderMetadata } : null;
  let transactionDepth = 0;
  const stats = { queries: 0, writes: 0, inserts: 0, claims: 0, invoiceReads: 0, http: [] };
  const copy = value => structuredClone(value);
  const listedStatuses = sql => {
    const list = sql.match(/(?:NOT\s+)?IN\s*\(([^)]+)\)/)?.[1];
    assert.ok(list, 'Expected an explicit SQL status list');
    return [...list.matchAll(/'([^']+)'/g)].map(match => match[1]);
  };
  const db = {
    patient: { findFirst: async ({ where }) => {
      assert.equal(where.id, input.patientId);
      assert.equal(where.organizationId, session.organizationId);
      assert.deepEqual(Array.from(where.clinicId.in), session.clinicIds);
      return { id: input.patientId, clinicId: connection.clinicId };
    } },
    auditLog: { create: async () => { stats.writes++; return {}; } },
    $queryRawUnsafe: async (sql, ...params) => {
      stats.queries++;
      if (sql.includes('SELECT EXISTS')) {
        assert.deepEqual(params, [connection.id, session.organizationId]);
        assert.match(sql, /"provider"='payos'/);
        assert.match(sql, /"entityType"='PAYOS_ORDER'/);
        // Evaluate the actual helper's terminal-status list, rather than baking
        // the application's unresolved/FAILED policy into this fake executor.
        return [{ unresolved: Boolean(order && !listedStatuses(sql).includes(order.metadata.status ?? 'PENDING')) }];
      }
      if (sql.trimStart().startsWith('SELECT') && sql.includes('"IntegrationConnection"')) {
        assert.ok(params.includes(connection.id) || params.includes(session.organizationId));
        return [copy(connection)];
      }
      if (sql.includes('FROM "Clinic"')) {
        assert.deepEqual(params, [connection.clinicId, session.organizationId]);
        return [{ id: connection.clinicId }];
      }
      if (sql.includes('FROM "Invoice"')) {
        stats.invoiceReads++;
        assert.match(sql, /FOR UPDATE/);
        assert.deepEqual(params, [session.organizationId, connection.clinicId, input.patientId, input.invoiceNo]);
        return invoice ? [copy(invoice)] : [];
      }
      if (sql.trimStart().startsWith('SELECT') && sql.includes('"ExternalReference"')) {
        const portOrder = sql.includes('IS NOT DISTINCT FROM');
        assert.deepEqual(params.slice(0, 4), portOrder
          ? [session.organizationId, 'payos', 'PAYOS_ORDER', connection.id]
          : [session.organizationId, connection.id, 'payos', 'PAYOS_ORDER']);
        const key = sql.includes('"internalId" = $5') ? 'internalId' : 'externalId';
        return order && order[key] === params[4] ? [copy(order)] : [];
      }
      if (sql.trimStart().startsWith('INSERT INTO "ExternalReference"')) {
        stats.writes++; stats.inserts++;
        assert.equal(order, null, 'A same-intent retry must not insert another order');
        order = { id: params[0], organizationId: params[1], clinicId: params[2], connectionId: params[3],
          provider: params[4], entityType: params[5], internalId: params[6], externalId: params[7],
          metadata: JSON.parse(params[8]) };
        return [copy(order)]; // The real substrate returns a plain row, with no .created.
      }
      if (sql.includes('UPDATE "ExternalReference"')) {
        assert.equal(params[0], order?.id);
        stats.writes++;
        if (sql.includes('jsonb_set')) {
          stats.claims++;
          if (!listedStatuses(sql).includes(order.metadata.status)) return [];
          const oldStatus = order.metadata.status;
          order.metadata = { ...order.metadata, status: 'CREATING' };
          delete order.metadata.errorCode;
          if (sql.includes('creationUncertain') && oldStatus === 'ERROR') order.metadata.creationUncertain = true;
        } else {
          const next = JSON.parse(params[1]);
          if (!['SETTLED', 'SIGNED'].includes(order.metadata.status) || ['SETTLED', 'SIGNED'].includes(next.status)) order.metadata = next;
        }
        return [copy(order)];
      }
      stats.writes++;
      throw new Error('Unexpected persistence statement in retry regression');
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { getSession: async () => session },
    '@/lib/env': { appBaseUrl: () => 'https://app.example.test' },
    '@/lib/prisma': { prisma: db },
    '@/lib/actions/permissions': { canPerformAction: () => true },
    '@/lib/permissions': { hasAnyRole: (_session, roles) => roles.includes(session.role) },
    '@/lib/tenant-scope': { accessibleClinicIds: () => session.clinicIds },
    '@/lib/patient-access': { allowedClinicIds: () => session.clinicIds },
    '@/lib/request-security': { hasSameOrigin: () => true },
    '@/lib/error-reporting': { reportApplicationError: () => {} },
    '@/lib/transaction': { runSerializableTransaction: async operation => {
      transactionDepth++;
      try { return await operation(db); } finally { transactionDepth--; }
    } },
    '@/infrastructure/integrations/credential-vault': { writeIntegrationSecrets: async () => {
      stats.writes++; throw new Error('Uncertain orders must block credential writes');
    } },
    '../connection-secrets': { payOSConnectionSecrets: async () => ({ clientId: 'synthetic-client',
      apiKey: 'synthetic-access', checksumKey: 'synthetic-checksum', baseUrl: 'https://merchant.example.test' }) },
  };
  const globals = { Request, Response, DOMException, fetch: async (url, init) => {
    assert.equal(transactionDepth, 0, 'Provider HTTP must occur after the reservation commits');
    assert.equal(url, 'https://merchant.example.test/v2/payment-requests');
    assert.equal(init.method, 'POST');
    assert.ok(init.signal instanceof AbortSignal, 'Provider HTTP must have a bounded timeout');
    const index = stats.http.length;
    stats.http.push(JSON.parse(init.body));
    assert.ok(index < outcomes.length, 'Unexpected provider call');
    if (outcomes[index] === 'timeout') throw new DOMException('Synthetic lost response after possible merchant acceptance', 'TimeoutError');
    return Response.json({ code: '01', desc: 'Synthetic provider rejection' }, { status: outcomes[index] });
  } };
  const cache = new Map();
  const module = file => load(file, mocks, globals, cache);
  const route = module('src/app/api/integrations/payos/payment-links/route.ts');
  const store = module('src/infrastructure/integrations/payos-workspace-store.ts');
  return {
    stats, input, metadata: () => copy(order?.metadata),
    post: () => route.POST(new Request('https://app.example.test/api/integrations/payos/payment-links', {
      method: 'POST', body: JSON.stringify(input),
    })),
    unresolved: () => store.hasUnresolvedPayOSOrders(db, connection.id, session.organizationId),
    changeSettings: action => module('src/lib/application/integrations/payos-settings.ts').savePayOSSettings(session, {
      action, clinicId: connection.clinicId,
      ...(action === 'save' ? { credentials: { clientId: 'synthetic-new-client', apiKey: 'synthetic-new-access', checksumKey: 'synthetic-new-checksum' } } : {}),
    }),
    legacyPost: () => module('src/app/api/integrations/connections/route.ts').POST(new Request('https://app.example.test/api/integrations/connections', {
      method: 'POST', body: JSON.stringify({ provider: 'payos', clinicId: connection.clinicId, secretRef: 'env:PAYOS_DEFAULT' }),
    })),
  };
}

test('timeout then same-intent 401 preserves uncertainty and blocks credential replacement/disable', async () => {
  const h = fixture({ outcomes: ['timeout', 401, 401] });
  assert.equal((await h.post()).status, 503);
  assert.equal(h.metadata().status, 'ERROR');
  assert.equal(h.metadata().creationUncertain, true);
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal((await h.post()).status, 401);
    assert.equal(h.metadata().status, 'ERROR');
    assert.equal(h.metadata().creationUncertain, true);
    assert.equal(await h.unresolved(), true);
    const writes = h.stats.writes;
    for (const action of ['save', 'disable']) await assert.rejects(h.changeSettings(action), { code: 'payos-orders-unresolved', status: 409 });
    assert.equal(h.stats.writes, writes, 'The real settings command must reject before any write');
  }
  assert.equal(h.stats.inserts, 1);
  assert.equal(h.stats.claims, 2);
  assert.equal(new Set(h.stats.http.map(request => request.orderCode)).size, 1, 'Every attempt must retain the durable order code');
});

test('invoice transfer memo fits payOS unlinked-bank nine-character limit and is signed as sent', async () => {
  const h = fixture({ outcomes: [401] });
  await h.post();
  const body = h.stats.http[0];
  assert.match(body.description, /^CDX\d{1,6}$/);
  assert.ok(body.description.length <= 9);
  const client = load('src/integrations/payos/client.ts');
  assert.equal(body.signature, client.signPayOSData({ amount: body.amount, cancelUrl: body.cancelUrl,
    description: body.description, orderCode: body.orderCode, returnUrl: body.returnUrl }, 'synthetic-checksum'));
});

for (const status of [400, 401, 403, 422]) {
  test(`first-attempt provider ${status} is definitively FAILED and permits credential repair`, async () => {
    const h = fixture({ outcomes: [status] });
    assert.equal((await h.post()).status, status);
    assert.equal(h.metadata().status, 'FAILED');
    assert.equal(h.metadata().creationUncertain, false);
    assert.equal(await h.unresolved(), false);
    assert.equal(h.stats.http.length, 1);
  });
}

test('legacy ERROR without an uncertainty flag cannot become FAILED on retry rejection', async () => {
  const h = fixture({ metadata: { status: 'ERROR' }, outcomes: [401] });
  assert.equal((await h.post()).status, 401);
  assert.equal(h.metadata().status, 'ERROR');
  assert.equal(h.metadata().creationUncertain, true);
  assert.equal(await h.unresolved(), true);
  assert.equal(h.stats.inserts, 0);
});

for (const status of [409, 500, 503]) {
  test(`provider ${status} remains uncertain and blocks rotation`, async () => {
    const h = fixture({ outcomes: [status] });
    assert.equal((await h.post()).status, status);
    assert.equal(h.metadata().status, 'ERROR');
    assert.equal(h.metadata().creationUncertain, true);
    assert.equal(await h.unresolved(), true);
  });
}

const invalidInvoices = [
  ['missing', null, 404, 'payos-invoice-not-found'],
  ['VOID', { amount: 100000, paidAmount: 0, status: 'VOID' }, 404, 'payos-invoice-not-found'],
  ['paid', { amount: 100000, paidAmount: 100000, status: 'PAID' }, 409, 'payos-invoice-amount-invalid'],
  ['over balance', { amount: 100000, paidAmount: 50000, status: 'PARTIAL' }, 409, 'payos-invoice-amount-invalid'],
];
for (const retryStatus of ['ERROR', 'FAILED']) {
  for (const [label, invoice, httpStatus, code] of invalidInvoices) {
    test(`${retryStatus} retry with ${label} invoice rejects before claim or provider HTTP`, async () => {
      const h = fixture({ metadata: { status: retryStatus }, invoice });
      const response = await h.post();
      assert.equal(response.status, httpStatus);
      assert.equal((await response.json()).error, code);
      assert.equal(h.stats.invoiceReads, 1);
      assert.equal(h.stats.claims, 0);
      assert.equal(h.stats.writes, 0);
      assert.equal(h.stats.http.length, 0);
      assert.equal(h.metadata().status, retryStatus);
    });
  }
}

test('legacy payOS configuration POST returns 409 before touching persistence', async () => {
  const h = fixture();
  const response = await h.legacyPost();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'payos-use-settings');
  assert.equal(h.stats.queries, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.http.length, 0);
});

test('SETTLED replay without checkout returns the durable order without recreating or checking balance', async () => {
  const h = fixture({ metadata: { status: 'SETTLED', receiptNo: 'RCT-EXISTING' },
    invoice: { amount: 100000, paidAmount: 100000, status: 'PAID' } });
  const response = await h.post();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'SETTLED');
  assert.equal(body.orderCode, 123456);
  assert.equal(body.duplicate, true);
  assert.equal(body.checkoutUrl, null);
  assert.equal(h.metadata().receiptNo, 'RCT-EXISTING');
  assert.equal(h.stats.invoiceReads, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.http.length, 0);
});

test('already-created replay retains the checkout even when the invoice balance is now zero', async () => {
  const h = fixture({ metadata: { status: 'PENDING', checkoutUrl: 'https://pay.example.test/existing' },
    invoice: { amount: 100000, paidAmount: 100000, status: 'PAID' } });
  const response = await h.post();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.duplicate, true);
  assert.equal(body.checkoutUrl, 'https://pay.example.test/existing');
  assert.equal(h.stats.invoiceReads, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.http.length, 0);
});

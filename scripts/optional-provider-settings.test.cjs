const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');
const definition = { provider: 'chatwoot', name: 'Chatwoot', description: '', fields: [
  { key: 'baseUrl', label: 'URL', required: true, secret: false },
  { key: 'accountId', label: 'Account', required: true, secret: false },
  { key: 'apiToken', label: 'Token', required: true, secret: true },
] };
const owner = { userId: 'owner-a', organizationId: 'org-a', role: 'OWNER', roles: ['OWNER'], isDemo: false,
  clinicIds: ['clinic-a'], clinics: [{ id: 'clinic-a', name: 'Synthetic' }], activeClinicId: null };
const credentials = { baseUrl: 'https://provider.test', accountId: '1', apiToken: 'synthetic-private-key' };
function fixture() {
  let row = null, stored = null, references = false, depth = 0, demo = false;
  const audits = [], calls = { reads: 0, writes: 0, secretReads: 0 };
  const db = {
    organization: { findUnique: async () => ({ isDemo: demo }) },
    clinic: { findFirst: async ({ where }) => where.id === 'clinic-a' && where.organizationId === 'org-a' ? { id: 'clinic-a' } : null },
    auditLog: { create: async input => { audits.push(structuredClone(input.data)); } },
    $queryRawUnsafe: async (sql, ...params) => {
      calls.reads++;
      if (sql.includes('AS linked')) { assert.deepEqual(params, ['org-a', 'connection-a', 'chatwoot']); return [{ linked: references }]; }
      if (sql.includes('IntegrationConnection')) {
        if (sql.includes('"provider" = $2')) return row?.status === 'ACTIVE' ? [structuredClone(row)] : [];
        if (params[0] !== 'org-a' || params[1] !== 'chatwoot') return [];
        if (sql.includes('ANY')) return row ? [structuredClone(row)] : [];
        return row && row.clinicId === params[2] ? [structuredClone(row)] : [];
      }
      throw new Error('Unexpected SQL');
    },
  };
  const api = load('src/lib/application/integrations/optional-provider-settings.ts', {
    '@/lib/prisma': { prisma: db },
    '@/lib/transaction': { runSerializableTransaction: async run => { depth++; try { return await run(db); } finally { depth--; } } },
    '@/integrations/optional-http': { optionalProviderBaseUrl: value => { assert.equal(value, 'https://provider.test'); return value; } },
    '@/infrastructure/integrations/credential-vault': {
      readIntegrationSecrets: async (_db, scope) => { calls.secretReads++; assert.equal(scope.organizationId, 'org-a'); return structuredClone(stored); },
      writeIntegrationSecrets: async (_db, scope, value) => { assert.ok(depth); assert.equal(scope.connectionId, 'connection-a'); calls.writes++; stored = structuredClone(value); },
    },
    '@/infrastructure/integrations/substrate': { upsertIntegrationConnection: async (_db, input) => {
      calls.writes++; assert.ok(depth);
      row = { id: 'connection-a', createdAt: new Date('2026-11-06T00:00:00Z'), updatedAt: new Date('2026-11-06T00:00:00Z'),
        secretRef: 'vault:v1', lastVerifiedAt: null, metadata: {}, ...row, ...structuredClone(input) };
      return structuredClone(row); // Deliberately hold timestamps constant: versions must fence races.
    } },
  });
  const verify = async () => { assert.equal(depth, 0, 'HTTP must be outside transaction'); return { identity: 'account:1' }; };
  const change = (action, input = {}, session = owner, probe = verify) => api.configureOptionalProvider(session, definition,
    { clinicId: 'clinic-a', action, ...(action === 'save' || action === 'rotate' ? { credentials } : {}), ...input }, probe);
  return { api, calls, audits, change, verify, row: () => row, stored: () => stored,
    references: value => { references = value; }, demo: value => { demo = value; } };
}
test('saved optional credentials remain disabled, are not read back, and require actual verification', async () => {
  const h = fixture(); const saved = await h.change('save');
  assert.equal(saved.connections[0].status, 'DISABLED'); assert.equal(saved.connections[0].verified, false);
  assert.ok(!JSON.stringify(saved).includes(credentials.apiToken)); assert.ok(!JSON.stringify(h.audits).includes(credentials.apiToken));
  const ready = await h.change('verify'); assert.equal(ready.connections[0].status, 'ACTIVE'); assert.equal(ready.connections[0].verified, true);
  const loaded = await h.api.loadOptionalProviderConnection(owner, 'chatwoot', 'clinic-a'); assert.equal(loaded.secrets.apiToken, credentials.apiToken);
});
test('optional settings reject demo, denied role and inaccessible clinic before persistence', async () => {
  for (const [session, body] of [[{ ...owner, role: 'DENTIST', roles: ['DENTIST'] }, {}],
    [{ ...owner, isDemo: true }, {}], [owner, { clinicId: 'clinic-b' }],
    [{ ...owner, role: 'CLINIC_MANAGER', roles: ['CLINIC_MANAGER'] }, { clinicId: null }]]) {
    const h = fixture(); await assert.rejects(h.change('save', body, session), error => error.status === 403);
    assert.equal(h.calls.reads + h.calls.writes, 0);
  }
});
test('verification failure cannot activate or replace saved credentials', async () => {
  const h = fixture(); await h.change('save');
  await assert.rejects(h.change('verify', {}, owner, async () => { throw new Error('synthetic provider outage'); }));
  assert.equal(h.row().status, 'DISABLED'); assert.equal(h.row().lastVerifiedAt, null);
});
for (const action of ['save', 'disable']) test(`${action} during verification prevents stale activation even with identical timestamps`, async () => {
  const h = fixture(); await h.change('save');
  await assert.rejects(h.change('verify', {}, owner, async () => { await h.change(action); return { identity: 'account:1' }; }), { code: 'integration-configuration-changed' });
  assert.equal(h.row().status, 'DISABLED');
});
test('linked data blocks account replacement but permits verified same-account secret rotation', async () => {
  const h = fixture(); await h.change('save'); await h.change('verify'); h.references(true);
  await assert.rejects(h.change('save'), { code: 'integration-use-credential-rotation' });
  await h.change('rotate', { credentials: { ...credentials, apiToken: 'synthetic-rotated-key' } });
  assert.equal(h.stored().apiToken, 'synthetic-rotated-key'); assert.equal(h.row().status, 'ACTIVE');
  await assert.rejects(h.change('rotate', { credentials: { ...credentials, accountId: '2' } }), { code: 'integration-account-binding-mismatch' });
  await assert.rejects(h.change('rotate', {}, owner, async () => ({ identity: 'account:other' })), { code: 'integration-account-binding-mismatch' });
  assert.equal(h.stored().apiToken, 'synthetic-rotated-key');
});
test('worker loader validates canonical demo and clinic ownership before reading keys', async () => {
  const h = fixture(); await h.change('save'); await h.change('verify'); const before = h.calls.secretReads;
  await assert.rejects(h.api.loadOptionalProviderConnectionForScope({ organizationId: 'org-a', clinicId: 'other' }, 'chatwoot'), { code: 'integration-clinic-forbidden' });
  h.demo(true);
  await assert.rejects(h.api.loadOptionalProviderConnectionForScope({ organizationId: 'org-a', clinicId: 'clinic-a' }, 'chatwoot'), { code: 'integration-demo-unavailable' });
  assert.equal(h.calls.secretReads, before);
});

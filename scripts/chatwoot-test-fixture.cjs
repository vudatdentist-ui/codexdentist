const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');
const { AsyncLocalStorage } = require('node:async_hooks');
const { syntheticChatwoot } = require('./chatwoot-contract-driver.cjs');

function fixture(options = {}) {
  const session = { organizationId: 'org', userId: 'owner', role: 'OWNER', roles: ['OWNER'], roleAssignments: [],
    clinicIds: ['clinic'], activeClinicId: 'clinic', isDemo: false, ...options.session };
  const patient = { id: 'patient', clinicId: 'clinic', organizationId: 'org' };
  const connection = { id: 'connection', organizationId: 'org', clinicId: 'clinic', provider: 'chatwoot', status: 'ACTIVE',
    secretRef: 'vault:v1', lastVerifiedAt: new Date(), updatedAt: new Date(), metadata: { configurationVersion: 'v1', verifiedVersion: 'v1' } };
  const secrets = { baseUrl: 'https://chatwoot.example.test', apiToken: 'synthetic-chatwoot-token', accountId: '1', inboxId: '2', ...options.secrets };
  const provider = options.provider ?? syntheticChatwoot();
  let refs = [], audit = [], txDepth = 0, tail = Promise.resolve();
  const transactionContext = new AsyncLocalStorage();
  const controls = { auditFailure: null, configured: true, sameOrigin: true, sessionPresent: true, beforeTransaction: async () => {} };
  const copy = value => structuredClone(value);
  const db = {
    patient: { findFirst: async ({ where }) => {
      assert.deepEqual(Object.keys(where).sort(), ['clinicId', 'id', 'organizationId']);
      return where.id === patient.id && where.organizationId === patient.organizationId && where.clinicId.in.includes(patient.clinicId) ? copy(patient) : null;
    } },
    auditLog: { create: async ({ data }) => {
      assert.ok(txDepth, 'Audit must share the reference transaction');
      if (controls.auditFailure === data.action) throw new Error('Synthetic audit failure');
      audit.push(copy(data)); return data;
    } },
    $transaction: async (operation, options) => {
      assert.equal(options.isolationLevel, 'ReadCommitted', 'Fresh post-lock snapshot is required for first-create races');
      const previous = tail; let release; tail = new Promise(resolve => { release = resolve; }); await previous;
      const snapshot = copy({ refs, audit }); txDepth++;
      try { await controls.beforeTransaction(); return await transactionContext.run(true, () => operation(db)); }
      catch (error) { refs = snapshot.refs; audit = snapshot.audit; throw error; }
      finally { txDepth--; release(); }
    },
    $executeRawUnsafe: async (sql, ...args) => {
      assert.ok(txDepth, 'Mutation/lock must be transactional');
      if (sql.includes('FROM "Patient"') && sql.includes('FOR UPDATE')) { assert.deepEqual(args, ['patient', 'org']); return 1; }
      if (sql.includes('UPDATE "ExternalReference"')) {
        const row = refs.find(row => row.id === args[0]); assert.ok(row); row.metadata = JSON.parse(args[1]); return 1;
      }
      throw new Error(`Unexpected SQL mutation ${sql}`);
    },
    $queryRawUnsafe: async (sql, ...args) => {
      if (sql.includes('FROM "Clinic"')) return args[0] === 'clinic' && args[1] === 'org' ? [{ id: 'clinic' }] : [];
      if (sql.includes('FROM "IntegrationConnection"')) {
        if (sql.includes('FOR SHARE')) {
          assert.ok(txDepth); assert.equal(args[0], connection.id); assert.equal(args[1], 'org'); assert.equal(args[3], 'clinic');
          return connection.status === 'ACTIVE' && args[2] === connection.metadata.configurationVersion && args[2] === connection.metadata.verifiedVersion ? [{ id: connection.id }] : [];
        }
        return [copy(connection)];
      }
      if (sql.includes('FROM "ExternalReference"')) {
        if (sql.includes("'CHATWOOT_PATIENT'")) return copy(refs.filter(row => row.organizationId === args[0] && row.internalId === args[1]));
        return copy(refs.filter(row => row.organizationId === args[0] && row.provider === args[1] && row.entityType === args[2] && row.connectionId === args[3] &&
          (sql.includes('"externalId" = $5') ? row.externalId === args[4] : row.internalId === args[4])));
      }
      if (sql.includes('INSERT INTO "ExternalReference"')) {
        assert.ok(txDepth);
        const row = { id: args[0], organizationId: args[1], clinicId: args[2], connectionId: args[3], provider: args[4], entityType: args[5],
          internalId: args[6], externalId: args[7], metadata: JSON.parse(args[8]), createdAt: new Date(), updatedAt: new Date() };
        assert.ok(!refs.some(ref => ref.internalId === row.internalId)); refs.push(row); return [copy(row)];
      }
      throw new Error(`Unexpected SQL query ${sql}`);
    },
  };
  const mocks = {
    '@/lib/prisma': { prisma: db },
    '@/lib/auth': { getSession: async () => controls.sessionPresent ? session : null },
    '@/lib/request-security': { hasSameOrigin: () => controls.sameOrigin },
    '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnection: async (actor, providerName, clinicId) => {
      assert.equal(actor.organizationId, 'org'); assert.equal(providerName, 'chatwoot'); assert.equal(clinicId, 'clinic');
      if (!controls.configured) throw Object.assign(new Error('Disabled'), { status: 409 });
      return { connection: copy(connection), secrets: copy(secrets) };
    } },
    '@/integrations/optional-http': { optionalProviderFetch: async (url, init) => {
      // Another request may hold a transaction concurrently; track the current
      // async operation rather than treating a process-wide count as its context.
      assert.equal(transactionContext.getStore(), undefined, 'Real provider I/O must be outside its DB transaction');
      assert.equal(new URL(url).origin, secrets.baseUrl);
      if (options.optionalProviderFetch) return options.optionalProviderFetch(url, init);
      return Response.json(await provider.handle(url, init));
    } },
  };
  const cache = new Map(), globals = { Response, Request, Headers, TextDecoder };
  const app = load('src/lib/application/integrations/chatwoot-patient.ts', mocks, globals, cache);
  const route = load('src/app/api/integrations/chatwoot/patient-conversations/route.ts', mocks, globals, cache);
  const adapter = load('src/integrations/chatwoot/client.ts', mocks, globals, cache);
  return { app, route, adapter, session, patient, connection, secrets, provider: provider.state, controls,
    refs: () => refs, audit: () => audit, ensure: () => app.manageChatwootPatient(session, { patientId: 'patient', action: 'ensure' }),
    recover: () => app.manageChatwootPatient(session, { patientId: 'patient', action: 'recover' }),
    get: () => app.getChatwootPatient(session, 'patient') };
}

module.exports = { fixture };

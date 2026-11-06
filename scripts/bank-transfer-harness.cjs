const assert = require('node:assert/strict');
const { load } = require('./audit-source-loader.cjs');
const copy = value => JSON.parse(JSON.stringify(value));
const globals = { TextEncoder, TextDecoder };
const account = { bankBin: '970436', accountNumber: '000000000000', recipientName: 'SYNTHETIC TEST ONLY' };
const owner = { userId: 'user-a', organizationId: 'org-a', role: 'OWNER', roles: ['OWNER'], roleAssignments: [],
  activeClinicId: null, clinicIds: ['clinic-a'], clinics: [{ id: 'clinic-a', name: 'Synthetic clinic' }], isDemo: false };
const body = { action: 'save', clinicId: 'clinic-a', ...account, accountConfirmed: true };
function harness(options = {}) {
  const state = { session: options.session === undefined ? owner : options.session,
    patient: { id: 'patient-a', organizationId: 'org-a', clinicId: 'clinic-a', ...options.patient },
    invoice: { id: 'invoice-a', patientId: 'patient-a', invoiceNo: 'HD-001', organizationId: 'org-a', clinicId: 'clinic-a', amount: '200000.00', paidAmount: '50000.00', status: 'OPEN', ...options.invoice },
    connection: options.noConnection ? null : { id: 'connection-a', organizationId: 'org-a', clinicId: 'clinic-a', provider: 'bank-transfer', status: 'ACTIVE', secretRef: 'vault:v1', updatedAt: new Date(), ...options.connection },
    ciphertext: null, writes: [], audits: [], queries: [], reads: 0 };
  const vault = load('src/infrastructure/integrations/credential-vault.ts', { '@/lib/env': { authSecret: () => 'synthetic-test-key-never-operational' } }, { Object, JSON });
  const secretScope = { organizationId: 'org-a', connectionId: 'connection-a', provider: 'bank-transfer' };
  if (state.connection) state.ciphertext = vault.sealIntegrationSecrets(secretScope, account);
  const db = {
    patient: { findFirst: async ({ where }) => {
      state.reads++; return !options.missingPatient && where.id === state.patient.id && where.organizationId === state.patient.organizationId &&
        where.clinicId.in.includes(state.patient.clinicId) ? state.patient : null;
    } },
    invoice: { findFirst: async ({ where }) => { state.reads++; return !options.missingInvoice &&
      ['organizationId', 'clinicId', 'patientId', 'invoiceNo'].every(k => state.invoice[k] === where[k]) ? state.invoice : null; } },
    integrationConnection: { findFirst: async () => state.connection, findMany: async query => { state.queries.push(copy(query)); return state.connection ? [state.connection] : []; } },
    $queryRawUnsafe: async (sql, ...args) => { state.queries.push({ sql, args });
      if (sql.includes('advisory')) return [];
      assert.equal(args[0], 'org-a'); assert.equal(args[1], 'clinic-a'); return state.connection ? [state.connection] : [];
    },
    auditLog: { create: async ({ data }) => { state.audits.push(copy(data)); } },
  };
  const mocks = {
    '@/lib/auth': { getSession: async () => state.session },
    '@/lib/prisma': { prisma: db },
    '@/lib/transaction': { runSerializableTransaction: async fn => fn(db) },
    '@/infrastructure/integrations/substrate': { upsertIntegrationConnection: async (_tx, data) => {
      state.writes.push(copy(data)); state.connection = { ...state.connection, ...data, id: 'connection-a', updatedAt: new Date() }; return state.connection;
    } },
    '@/infrastructure/integrations/credential-vault': {
      writeIntegrationSecrets: async (_tx, scope, value) => { assert.deepEqual(copy(scope), secretScope); state.ciphertext = vault.sealIntegrationSecrets(scope, copy(value)); },
      readIntegrationSecrets: async (_tx, scope) => { assert.deepEqual(copy(scope), secretScope); return options.missingKeys ? null : vault.openIntegrationSecrets(scope, state.ciphertext); },
    },
    'next/server': { NextResponse: { json: (data, init) => Response.json(data, init) } },
  };
  const api = load('src/lib/application/integrations/bank-transfer.ts', mocks, globals);
  const qr = load('src/app/api/integrations/bank-transfer/qr/route.ts', mocks, globals);
  const settings = load('src/app/api/integrations/bank-transfer/settings/route.ts', mocks, globals);
  const request = (data, origin = 'https://app.test') => new Request('https://app.test/api/integrations/bank-transfer', {
    method: 'POST', headers: { 'Content-Type': 'application/json', origin, host: 'app.test' }, body: JSON.stringify(data),
  });
  return { state, api, routes: { qr, settings }, qr: (data = {}, origin) => qr.POST(request({ patientId: 'patient-a', invoiceNo: 'HD-001', amount: 150000, ...data }, origin)),
    save: (data = body) => settings.POST(request(data)), get: () => settings.GET(), settings };
}
module.exports = { harness };

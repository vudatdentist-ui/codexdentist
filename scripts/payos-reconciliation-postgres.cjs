const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { load } = require('./audit-source-loader.cjs');
const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
assert.ok(process.env.NODE_ENV === 'test' && url && ['127.0.0.1','localhost','[::1]'].includes(url.hostname) &&
  ![...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service|user|password|connectionstring)$/i.test(key)), 'Explicit loopback test administrator required');
const name = 'payos_reconcile_test_' + randomBytes(8).toString('hex');
const target = new URL(url); target.pathname = '/' + name;
const admin = new Client({ connectionString: url.toString() });
let created = false, prisma;
const pending = [], gates = [];
async function main() {
  try {
    await admin.connect(); assert.match(name, /^payos_reconcile_test_[a-f0-9]{16}$/);
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    await admin.query(`ALTER DATABASE "${name}" SET timezone TO 'Asia/Bangkok'`);
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 60000, windowsHide: true,
    });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
    const org = await prisma.organization.create({ data: { name: 'Synthetic reconciliation race' } });
    const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: 'Synthetic', city: 'QA', address: 'QA' } });
    const actor = await prisma.user.create({ data: { organizationId: org.id, role: 'OWNER', fullName: 'Synthetic owner', email: 'payos-native@example.test', passwordHash: 'synthetic-not-a-login' } });
    const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id, fullName: 'Synthetic patient', phone: '0000000000', medicalAlerts: [] } });
    const session = { organizationId: org.id, userId: actor.id, role: 'OWNER', roles: ['OWNER'], isDemo: false,
      clinicIds: [clinic.id], clinics: [{ id: clinic.id, name: clinic.name }], activeClinicId: null };
    let fetchStatus;
    const mocks = { '@/lib/prisma': { prisma }, '@/lib/env': { authSecret: () => 'synthetic-stable-vault-master-20261105', appBaseUrl: () => 'https://app.test' },
      '@/integrations/payos/client': { getPayOSPaymentLinkStatus: (...args) => fetchStatus(...args) } };
    const cache = new Map(), module = file => load(file, mocks, { Object, JSON }, cache);
    const substrate = module('src/infrastructure/integrations/substrate.ts');
    const vault = module('src/infrastructure/integrations/credential-vault.ts');
    // The source loader gives each module a separate VM realm. Normalize only
    // that test boundary's plain dictionary; encryption and SQL stay real.
    mocks['@/infrastructure/integrations/credential-vault'] = { ...vault,
      writeIntegrationSecrets: (db, scope, value) => vault.writeIntegrationSecrets(db, scope, JSON.parse(JSON.stringify(value))) };
    const store = module('src/infrastructure/integrations/phase3-store.ts');
    const { reconcilePayOSOrder } = module('src/lib/application/integrations/payos-reconcile.ts');
    const { savePayOSSettings } = module('src/lib/application/integrations/payos-settings.ts');
    const { recordProviderSettlementCommand } = module('src/lib/application/revenue/provider-settlement.ts');
    const connection = await substrate.upsertIntegrationConnection(prisma, { organizationId: org.id, clinicId: clinic.id, provider: 'payos', secretRef: 'vault:v1' });
    const scope = { organizationId: org.id, connectionId: connection.id, provider: 'payos' };
    const credentials = { clientId: 'synthetic-client', apiKey: 'synthetic-access', checksumKey: 'synthetic-checksum' };
    await vault.writeIntegrationSecrets(prisma, scope, credentials);
    const secrets = async (_connection, tx) => { assert.ok(tx !== prisma); return { ...await vault.readIntegrationSecrets(tx, scope), baseUrl: 'https://merchant.test' }; };
    let orderIndex = 0;
    const order = () => substrate.createExternalReference(prisma, { organizationId: org.id, clinicId: clinic.id, connectionId: connection.id,
      provider: 'payos', entityType: 'PAYOS_ORDER', internalId: 'native-intent-' + ++orderIndex, externalId: String(178349999912300 + orderIndex),
      metadata: { patientId: patient.id, amount: 100000, status: 'ERROR', creationUncertain: true } });
    const row = async id => (await prisma.$queryRawUnsafe('SELECT * FROM "ExternalReference" WHERE "id"=$1', id))[0];
    const observation = status => ({ paymentLinkId: 'native-provider-id', orderCode: 178349999912301, amount: 100000,
      amountPaid: status === 'PAID' ? 100000 : 0, amountRemaining: status === 'PAID' ? 0 : 100000, status });
    const first = await order();
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; }); const wait = new Promise(resolve => { release = resolve; }); gates.push(release);
    fetchStatus = async () => { entered(); await wait; return observation('CANCELLED'); };
    const request = reconcilePayOSOrder(session, first.id, secrets); pending.push(request); await started;
    // This returns while HTTP is in flight, proving the connection lock was released.
    await assert.rejects(savePayOSSettings(session, { action: 'disable', clinicId: clinic.id }), { code: 'payos-orders-unresolved' });
    const settlement = await prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT "id" FROM "ExternalReference" WHERE "id"=$1 FOR UPDATE', first.id);
      const receipt = await recordProviderSettlementCommand(tx, { organizationId: org.id, clinicId: clinic.id, patientId: patient.id,
        amount: 100000, method: 'bank_transfer', provider: 'payos', providerReference: 'synthetic-transfer', providerEventId: 'synthetic-event' });
      await store.updateExternalReferenceMetadata(tx, first.id, { ...first.metadata, status: 'SETTLED', receiptNo: receipt.receiptNo });
      return receipt;
    });
    release(); assert.equal((await request).status, 'SETTLED'); assert.equal((await row(first.id)).metadata.receiptNo, settlement.receiptNo);
    assert.equal(await prisma.receipt.count(), 1);
    const second = await order(); fetchStatus = async () => observation('EXPIRED');
    assert.equal((await reconcilePayOSOrder(session, second.id, secrets)).status, 'CANCELLED');
    await savePayOSSettings(session, { action: 'save', clinicId: clinic.id, credentials: { ...credentials, apiKey: 'synthetic-rotated' } });
    for (const status of ['PENDING', 'ERROR', 'FAILED']) {
      const updated = await store.updateExternalReferenceMetadataWithRetry(prisma, second.id, { ...second.metadata, status, checkoutUrl: 'https://stale.test', qrCode: 'stale' });
      assert.equal(updated.metadata.status, 'CANCELLED'); assert.equal(updated.metadata.qrCode, null);
    }
    const third = await order(); const calls = [];
    fetchStatus = () => new Promise(resolve => { calls.push(resolve); gates.push(() => resolve(observation('CANCELLED'))); });
    const stale = reconcilePayOSOrder(session, third.id, secrets); pending.push(stale);
    const untilEntered = async count => {
      for (let attempt = 0; calls.length < count && attempt < 1000; attempt++) await new Promise(resolve => setTimeout(resolve, 5));
      assert.ok(calls.length >= count, 'Status request reaches its out-of-transaction provider boundary');
    };
    await untilEntered(1);
    const paid = reconcilePayOSOrder(session, third.id, secrets); pending.push(paid);
    await untilEntered(2);
    calls[1](observation('PAID')); assert.equal((await paid).amountPaid, 100000);
    calls[0](observation('CANCELLED')); const retained = await stale;
    assert.equal(retained.status, 'ERROR'); assert.equal(retained.amountPaid, 100000);
    await assert.rejects(savePayOSSettings(session, { action: 'disable', clinicId: clinic.id }), { code: 'payos-orders-unresolved' });
    assert.equal(await prisma.receipt.count(), 1); assert.equal(await prisma.payment.count(), 0);
    const observed = await row(third.id);
    const late = await store.updateExternalReferenceMetadataWithRetry(prisma, third.id, { ...third.metadata, status: 'PENDING', checkoutUrl: 'https://stale.test', qrCode: 'stale' });
    assert.equal(late.metadata.providerAmountPaid, 100000); assert.equal(late.metadata.providerStatus, 'PAID');
    assert.equal(late.metadata.providerCheckedAt, observed.metadata.providerCheckedAt);
    assert.ok(Math.abs(Date.now() - late.updatedAt.getTime()) < 5000, 'Metadata UTC timestamps remain correct in a UTC+7 session');
    console.log('ok native status recovery: webhook race, paid observation ordering, sealed-key rotation and late-write fencing');
  } finally {
    for (const release of gates) release(); await Promise.allSettled(pending);
    if (prisma) await prisma.$disconnect();
    if (created) { assert.match(name, /^payos_reconcile_test_[a-f0-9]{16}$/); await admin.query(`DROP DATABASE "${name}"`); }
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

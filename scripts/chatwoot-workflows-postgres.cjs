// Fresh disposable database only. Never runs against the supplied database itself.
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { load } = require('./audit-source-loader.cjs');
const { syntheticChatwoot } = require('./chatwoot-contract-driver.cjs');
const source = process.env.CHATWOOT_TEST_DATABASE_URL && new URL(process.env.CHATWOOT_TEST_DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !source || !['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname) ||
    [...source.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key)))
  throw new Error('Set NODE_ENV=test and explicit loopback CHATWOOT_TEST_DATABASE_URL.');
const name = 'chatwoot_operator_test_' + randomBytes(8).toString('hex'), target = new URL(source);
target.pathname = '/' + name;
const admin = new Pool({ connectionString: source.toString(), max: 1 });
async function main() {
  let created = false, prisma;
  try {
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', windowsHide: true,
    });
    if (migration.error || migration.status !== 0) throw new Error('Disposable migration failed: ' + (migration.stderr ?? ''));
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
    const org = await prisma.organization.create({ data: { name: 'Synthetic Chatwoot native' } });
    const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: 'Synthetic clinic', city: 'QA', address: 'QA' } });
    const actor = await prisma.user.create({ data: { organizationId: org.id, fullName: 'Synthetic owner', email: 'chatwoot-native@example.test', passwordHash: 'synthetic-not-a-login', role: 'OWNER' } });
    const patient = await prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id, fullName: 'Synthetic patient', phone: '0000000000', medicalAlerts: [] } });
    const other = await prisma.organization.create({ data: { name: 'Synthetic unrelated tenant' } });
    const session = { organizationId: org.id, userId: actor.id, role: 'OWNER', roles: ['OWNER'], roleAssignments: [],
      clinicIds: [clinic.id], activeClinicId: clinic.id, isDemo: false };
    const secrets = { baseUrl: 'https://chatwoot.example.test', apiToken: 'synthetic-chatwoot-token', accountId: '1', inboxId: '2' };
    const provider = syntheticChatwoot(), context = new AsyncLocalStorage();
    const wrapped = new Proxy(prisma, { get(target, key) {
      if (key === '$transaction') return (operation, options) => target.$transaction(tx => context.run(true, () => operation(tx)), options);
      const result = Reflect.get(target, key); return typeof result === 'function' ? result.bind(target) : result;
    } });
    const mocks = {
      '@/lib/prisma': { prisma: wrapped },
      '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnection: async (actor, providerName, clinicId) => {
        assert.equal(actor.organizationId, org.id); assert.equal(providerName, 'chatwoot'); assert.equal(clinicId, clinic.id);
        const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "IntegrationConnection" WHERE "organizationId"=$1 AND "provider"='chatwoot'`, org.id);
        return { connection: rows[0], secrets };
      } },
      '@/integrations/optional-http': { optionalProviderFetch: async (url, init) => {
        assert.equal(context.getStore(), undefined, 'HTTP inside transaction'); return Response.json(await provider.handle(url, init));
      } },
    };
    const cache = new Map();
    const substrate = load('src/infrastructure/integrations/substrate.ts', mocks, {}, cache);
    await substrate.upsertIntegrationConnection(prisma, { organizationId: org.id, clinicId: clinic.id, provider: 'chatwoot', status: 'ACTIVE',
      secretRef: 'vault:v1', lastVerifiedAt: new Date(), metadata: { configurationVersion: 'native-v1', verifiedVersion: 'native-v1' } });
    const command = load('src/lib/application/integrations/chatwoot-patient.ts', mocks, { Response, Headers }, cache);
    let providerEntered, release;
    const entered = new Promise(resolve => { providerEntered = resolve; }), gate = new Promise(resolve => { release = resolve; });
    provider.state.before = async ({ path, method }) => {
      if (path.endsWith('/contacts') && method === 'POST') {
        const rows = await prisma.$queryRawUnsafe(`SELECT * FROM "ExternalReference" WHERE "organizationId"=$1 AND "internalId"=$2`, org.id, patient.id);
        assert.equal(rows.length, 1, 'Reservation committed and visible from independent connection before provider create');
        providerEntered(); await gate;
      }
    };
    const ensure = () => command.manageChatwootPatient(session, { patientId: patient.id, action: 'ensure' });
    const pending = ensure();
    await Promise.race([entered, pending.then(() => { throw new Error('Provider gate not reached'); })]);
    try {
      const concurrent = await Promise.all([ensure(), ensure()]); assert.ok(concurrent.every(row => row.state === 'UNKNOWN'));
    } finally { release(); }
    assert.equal((await pending).state, 'SAVED');
    assert.equal((await ensure()).state, 'SAVED'); assert.equal(provider.state.contacts.length, 1); assert.equal(provider.state.conversations.length, 1);
    provider.state.before = async () => {};
    let syntheticPhone = 0;
    const freshPatient = () => prisma.patient.create({ data: { organizationId: org.id, clinicId: clinic.id, fullName: 'Synthetic patient', phone: `000000000${++syntheticPhone}`, medicalAlerts: [] } });
    const concurrentPatient = await freshPatient();
    const concurrentEnsure = () => command.manageChatwootPatient(session, { patientId: concurrentPatient.id, action: 'ensure' });
    await Promise.all([concurrentEnsure(), concurrentEnsure(), concurrentEnsure(), concurrentEnsure()]);
    assert.equal((await concurrentEnsure()).state, 'SAVED'); assert.equal(provider.state.contacts.length, 2); assert.equal(provider.state.conversations.length, 2);
    for (const loss of ['loseContact', 'loseConversation']) {
      const lostPatient = await freshPatient(); provider.state[loss] = true;
      const input = { patientId: lostPatient.id, action: 'ensure' };
      await assert.rejects(command.manageChatwootPatient(session, input), /chatwoot-provider-unavailable/);
      await command.manageChatwootPatient(session, { ...input, action: 'recover' });
      assert.equal((await command.manageChatwootPatient(session, input)).state, 'SAVED');
    }
    assert.equal(provider.state.contacts.length, 4); assert.equal(provider.state.conversations.length, 4);
    const auditPatient = await freshPatient();
    await prisma.$executeRawUnsafe(`CREATE FUNCTION chatwoot_synthetic_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action=TG_ARGV[0] THEN RAISE EXCEPTION 'Synthetic audit failure'; END IF; RETURN NEW; END; $$`);
    const auditEnsure = () => command.manageChatwootPatient(session, { patientId: auditPatient.id, action: 'ensure' });
    await prisma.$executeRawUnsafe(`CREATE TRIGGER chatwoot_synthetic_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW
      EXECUTE FUNCTION chatwoot_synthetic_audit_fail('patient.chatwoot_requested')`);
    await assert.rejects(auditEnsure());
    assert.equal((await prisma.$queryRawUnsafe(`SELECT * FROM "ExternalReference" WHERE "internalId"=$1`, auditPatient.id)).length, 0);
    assert.equal(provider.state.contacts.length, 4, 'Failed audit cannot leave a provider request without a reservation');
    await prisma.$executeRawUnsafe(`DROP TRIGGER chatwoot_synthetic_audit ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER chatwoot_synthetic_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW
      EXECUTE FUNCTION chatwoot_synthetic_audit_fail('patient.chatwoot_conversation_linked')`);
    await assert.rejects(auditEnsure());
    assert.equal((await prisma.$queryRawUnsafe(`SELECT * FROM "ExternalReference" WHERE "internalId"=$1`, auditPatient.id))[0].metadata.status, 'CONVERSATION_CREATING');
    await prisma.$executeRawUnsafe(`DROP TRIGGER chatwoot_synthetic_audit ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION chatwoot_synthetic_audit_fail()`);
    assert.equal((await command.manageChatwootPatient(session, { patientId: auditPatient.id, action: 'recover' })).state, 'SAVED');
    assert.equal(provider.state.contacts.length, 5); assert.equal(provider.state.conversations.length, 5);
    const callsBefore = provider.state.calls.length;
    await assert.rejects(command.manageChatwootPatient({ ...session, organizationId: other.id }, { patientId: patient.id, action: 'ensure' }), /chatwoot-patient-not-found/);
    await assert.rejects(command.manageChatwootPatient({ ...session, clinicIds: [] }, { patientId: patient.id, action: 'ensure' }), /chatwoot-patient-not-found/);
    await assert.rejects(command.manageChatwootPatient({ ...session, role: 'PATIENT', roles: ['PATIENT'] }, { patientId: patient.id, action: 'ensure' }), /chatwoot-forbidden/);
    assert.equal(provider.state.calls.length, callsBefore);
    const refs = await prisma.$queryRawUnsafe(`SELECT * FROM "ExternalReference" WHERE "organizationId"=$1`, org.id);
    const audit = await prisma.auditLog.findMany({ where: { organizationId: org.id } });
    assert.equal(refs.length, 5); assert.equal(audit.length, 20);
    assert.doesNotMatch(JSON.stringify({ refs, audit }), /synthetic-private|synthetic-chatwoot-token/);
    assert.ok(await prisma.organization.findUnique({ where: { id: other.id } }));
    const integrity = spawnSync(process.execPath, ['scripts/data-integrity-smoke.mjs'], {
      env: { ...process.env, DATABASE_URL: target.toString() }, encoding: 'utf8', windowsHide: true,
    });
    if (integrity.error || integrity.status !== 0) throw new Error('Disposable data-integrity gate failed: ' + integrity.stdout + integrity.stderr);
    console.log('Chatwoot native PostgreSQL passed: fresh migrations, committed reservation visibility, first-create/conversation races, contact/conversation lost-response recovery, replay, tenant/clinic/role denials, audit-failure rollback/recovery.');
    console.log('Existing data-integrity gate passed against the same disposable migrated database.');
  } finally {
    if (prisma) await prisma.$disconnect();
    if (created) { assert.match(name, /^chatwoot_operator_test_[a-f0-9]{16}$/); await admin.query(`DROP DATABASE "${name}"`); }
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

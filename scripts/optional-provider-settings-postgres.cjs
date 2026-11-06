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
const name = 'optional_settings_test_' + randomBytes(8).toString('hex');
const target = new URL(url); target.pathname = '/' + name;
const admin = new Client({ connectionString: url.toString() });
let created = false, prisma, release;
const pending = [];
const definition = { provider: 'chatwoot', name: 'Chatwoot', description: '', fields: [
  { key: 'baseUrl', label: 'URL', required: true, secret: false }, { key: 'accountId', label: 'Account', required: true, secret: false },
  { key: 'apiToken', label: 'Token', required: true, secret: true }] };
const credentials = { baseUrl: 'https://provider.test', accountId: '1', apiToken: 'synthetic-private-key' };
async function main() {
  try {
    await admin.connect(); assert.match(name, /^optional_settings_test_[a-f0-9]{16}$/);
    await admin.query(`CREATE DATABASE "${name}"`); created = true;
    await admin.query(`ALTER DATABASE "${name}" SET timezone TO 'Asia/Bangkok'`);
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 60000, windowsHide: true });
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
    async function workspace(label) {
      const org = await prisma.organization.create({ data: { name: 'Synthetic optional ' + label } });
      const clinic = await prisma.clinic.create({ data: { organizationId: org.id, name: 'Synthetic', city: 'QA', address: 'QA' } });
      const actor = await prisma.user.create({ data: { organizationId: org.id, role: 'OWNER', fullName: 'Synthetic owner', email: label+'@example.test', passwordHash: 'not-a-login' } });
      return { org, clinic, session: { userId: actor.id, organizationId: org.id, role: 'OWNER', roles: ['OWNER'], roleAssignments: [], isDemo: false,
        clinicIds: [clinic.id], clinics: [{ id: clinic.id, name: clinic.name }], activeClinicId: null } };
    }
    const a = await workspace('a'), b = await workspace('b');
    const mocks = { '@/lib/prisma': { prisma }, '@/lib/env': { authSecret: () => 'synthetic-optional-vault-master-20261106' } };
    const globals = { Object, JSON, Headers, Response, process: { env: { OPTIONAL_PROVIDER_ALLOWED_ORIGINS: 'https://provider.test' } } };
    const cache = new Map(), module = file => load(file, mocks, globals, cache);
    const vault = module('src/infrastructure/integrations/credential-vault.ts');
    mocks['@/infrastructure/integrations/credential-vault'] = { ...vault,
      writeIntegrationSecrets: (db, scope, value) => vault.writeIntegrationSecrets(db, scope, JSON.parse(JSON.stringify(value))) };
    const api = module('src/lib/application/integrations/optional-provider-settings.ts');
    const probe = async () => ({ identity: 'Account/1' });
    const change = (w, action, input = {}, verify = probe) => api.configureOptionalProvider(w.session, definition,
      { clinicId: w.clinic.id, action, ...(['save','rotate'].includes(action) ? { credentials } : {}), ...input }, verify);
    for (const w of [a,b]) assert.equal((await change(w,'save')).connections[0].verified, false);
    const contenders = await Promise.allSettled([change(a,'verify'), change(b,'verify')]);
    assert.equal(contenders.filter(result => result.status === 'fulfilled').length, 1, 'One organization owns the external account');
    const denied = contenders.find(result => result.status === 'rejected');
    assert.equal(denied.reason.code, 'integration-account-owned-by-other-organization');
    const winner = contenders[0].status === 'fulfilled' ? a : b;
    const loaded = await api.loadOptionalProviderConnection(winner.session, 'chatwoot', winner.clinic.id);
    assert.equal(loaded.secrets.apiToken, credentials.apiToken);
    const seals = await prisma.$queryRawUnsafe('SELECT ciphertext FROM "IntegrationCredential"');
    assert.equal(seals.length, 2); assert.ok(seals.every(row => !row.ciphertext.includes(credentials.apiToken)));
    const sameOrgClinic = await prisma.clinic.create({ data: { organizationId: winner.org.id, name: 'Other synthetic', city: 'QA', address: 'QA' } });
    const otherScope = { ...winner, clinic: sameOrgClinic, session: { ...winner.session,
      clinicIds: [sameOrgClinic.id], clinics: [{ id: sameOrgClinic.id, name: sameOrgClinic.name }] } };
    await change(otherScope,'save'); assert.equal((await change(otherScope,'verify')).connections[0].verified, true, 'Same-organization clinics may share their account');
    const connectionId = loaded.connection.id;
    await prisma.$executeRawUnsafe(`INSERT INTO "ExternalReference"
      (id,"organizationId","clinicId","connectionId",provider,"entityType","internalId","externalId",metadata)
      VALUES ('synthetic-linked',$1,$2,$3,'chatwoot','TEST_LINK','synthetic','external','{}'::jsonb)`, winner.org.id, winner.clinic.id, connectionId);
    await assert.rejects(change(winner,'save'), { code: 'integration-use-credential-rotation' });
    await change(winner,'rotate', { credentials: { ...credentials, apiToken: 'synthetic-rotated-private-key' } });
    assert.equal((await api.loadOptionalProviderConnection(winner.session,'chatwoot',winner.clinic.id)).secrets.apiToken, 'synthetic-rotated-private-key');
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const verifying = change(winner, 'verify', {}, async () => { entered(); await gate; return probe(); }); pending.push(verifying);
    await started; await change(winner, 'disable'); release();
    await assert.rejects(verifying, { code: 'integration-configuration-changed' });
    await assert.rejects(api.loadOptionalProviderConnection(winner.session,'chatwoot',winner.clinic.id), { code: 'integration-connection-not-ready' });
    const audits = await prisma.auditLog.findMany({ select: { metadata: true } });
    assert.ok(!JSON.stringify(audits).includes(credentials.apiToken));
    console.log('ok native optional settings: sealed keys, cross-organization account race, same-org clinics, rotation and disable/version fence');
  } finally {
    release?.(); await Promise.allSettled(pending);
    await prisma?.$disconnect();
    if (created) { assert.match(name, /^optional_settings_test_[a-f0-9]{16}$/); await admin.query(`DROP DATABASE "${name}"`); }
    await admin.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

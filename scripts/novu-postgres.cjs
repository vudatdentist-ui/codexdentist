// Native PostgreSQL reservations; database and fixtures belong only to this run.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { execFileSync } = require('node:child_process');
const { load } = require('./audit-source-loader.cjs');
const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !url || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  [...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service|connectionstring)$/i.test(key))) throw new Error('Requires explicit disposable loopback test PostgreSQL');
const name = `novu_test_${randomBytes(8).toString('hex')}`, target = new URL(url); target.pathname = `/${name}`;
const admin = new Client({ connectionString: url.toString() }); let created = false, sends = 0;
let prisma;
const clients = [];
const executor = client => {
  let tail = Promise.resolve();
  const query = (sql, args) => { const pending = tail.then(() => client.query(sql, args)); tail = pending.catch(() => {}); return pending; };
  return { $queryRawUnsafe: async (sql, ...args) => (await query(sql, args)).rows,
    $executeRawUnsafe: async (sql, ...args) => (await query(sql, args)).rowCount };
};
(async () => {
  try {
    await admin.connect(); await admin.query(`CREATE DATABASE "${name}"`); created = true;
    execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
      cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 60000, windowsHide: true,
    });
    const connection = new Client({ connectionString: target.toString() }); clients.push(connection); await connection.connect();
    await connection.query(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('novu-org','Synthetic Novu',now()),('other-org','Other tenant',now())`);
    await connection.query(`INSERT INTO "Clinic" (id,"organizationId",name,city,address,"updatedAt") VALUES ('clinic','novu-org','Synthetic','QA','QA',now())`);
    await connection.query(`INSERT INTO "IntegrationConnection" (id,"organizationId","clinicId",provider,"lastVerifiedAt",metadata)
      VALUES ('connection','novu-org','clinic','novu',now(),'{"configurationVersion":"synthetic-version","verifiedVersion":"synthetic-version","providerIdentity":"provider-org/env/app"}')`);
    const loaded = { connection: (await connection.query('SELECT * FROM "IntegrationConnection" WHERE id=$1', ['connection'])).rows[0],
      secrets: { baseUrl: 'https://novu.example.test', apiKey: 'synthetic-key', environmentId: 'env', workflowId: 'generic-notice', testSubscriberId: 'cdx-test-operator', deliveryChannel: 'email' } };
    const db = executor(connection), scope = { organizationId: 'novu-org', clinicId: 'clinic' };
    const adapter = load('src/integrations/novu/client.ts', { '@/integrations/optional-http': {} });
    let loseResponse = true;
    const provider = { ...adapter, verifyNovuWorkflow: async () => ({ workflowDatabaseId: 'workflow' }),
      verifyNovuSyntheticSubscriber: async () => ({ subscriberDatabaseId: 'subscriber' }),
      verifyNovuSubscriber: async () => ({ subscriberDatabaseId: 'subscriber' }),
      createNovuSubscriber: async () => ({ subscriberDatabaseId: 'subscriber' }),
      triggerNovu: async () => { sends++; if (loseResponse) throw new Error('Synthetic accepted-but-lost response'); },
      observeNovuDelivery: async () => 'SENT' };
    const api = load('src/lib/application/integrations/novu-delivery.ts', {
      '@/lib/prisma': { prisma: db }, '@/lib/application/integrations/optional-provider-settings': {},
      '@/lib/transaction': { runSerializableTransaction: async operation => {
        for (let attempt = 0; attempt < 8; attempt++) {
          const client = new Client({ connectionString: target.toString() }); clients.push(client); await client.connect();
          try {
            await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
            const result = await operation(executor(client)); await client.query('COMMIT'); return result;
          } catch (error) { await client.query('ROLLBACK'); if (!['40001', '40P01', 'P2034'].includes(error.code) || attempt === 7) throw error; }
          finally { await client.end(); clients.splice(clients.indexOf(client), 1); }
        }
      } },
      '@/integrations/novu/client': provider,
    });
    const input = { internalId: 'synthetic-test-intent', subscriberId: 'cdx-test-operator', synthetic: true };
    const results = await Promise.all(Array.from({ length: 6 }, () => api.sendNovuDelivery(scope, loaded, input)));
    assert.equal(sends, 1); assert.equal(results.filter(r => !r.duplicate).length, 1);
    const rows = (await connection.query('SELECT * FROM "ExternalReference"')).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].metadata.state, 'UNCERTAIN');
    assert.equal(await api.hasUnresolvedNovuDeliveries(db, scope.organizationId, loaded.connection.id), true);
    assert.equal(await api.hasUnresolvedNovuDeliveries(db, 'other-org', loaded.connection.id), false);
    await api.sendNovuDelivery(scope, loaded, input); assert.equal(sends, 1);
    await assert.rejects(api.reconcileNovuDelivery({ ...scope, organizationId: 'other-org' }, loaded, rows[0].id), { code: 'novu-delivery-not-found' });
    assert.equal((await api.reconcileNovuDelivery(scope, loaded, rows[0].id)).state, 'SENT');
    assert.equal(await api.hasUnresolvedNovuDeliveries(db, scope.organizationId, loaded.connection.id), false);
    await api.sendNovuDelivery(scope, loaded, input); assert.equal(sends, 1);
    console.log('Novu native PostgreSQL: full migrations, six-worker reservation race, timeout/retry, tenant denial, authenticated reconciliation passed');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target.toString() }) });
    loaded.connection = (await prisma.$queryRawUnsafe('SELECT * FROM "IntegrationConnection" WHERE id=$1', 'connection'))[0];
    const patient = await prisma.patient.create({ data: { ...scope, fullName: 'Synthetic notification', phone: '0000000000', email: 'synthetic@example.test', medicalAlerts: [] } });
    const mocks = { '@/lib/prisma': { prisma }, '@/integrations/novu/client': provider,
      '@/lib/application/integrations/optional-provider-settings': { loadOptionalProviderConnectionForScope: async () => loaded,
        loadOptionalProviderConnection: async () => loaded } };
    mocks['@/lib/transaction'] = load('src/lib/transaction.ts', mocks);
    const delivery = load('src/lib/application/integrations/novu-delivery.ts', mocks);
    const operator = load('src/lib/application/integrations/novu-operator.ts', mocks);
    const owner = await prisma.user.create({ data: { organizationId: scope.organizationId, fullName: 'Synthetic operator',
      email: 'operator@example.test', passwordHash: 'synthetic-unusable-password-hash', role: 'OWNER' } });
    const session = { userId: owner.id, organizationId: scope.organizationId, role: 'OWNER', roles: ['OWNER'], isDemo: false,
      roleAssignments: [{ role: 'OWNER', organizationId: scope.organizationId, clinicId: null }], clinicIds: [scope.clinicId], activeClinicId: null };
    const mappingResults = await Promise.all(Array.from({ length: 3 }, () => operator.runNovuOperatorCommand(session,
      { action: 'allocate-subscriber', clinicId: scope.clinicId, patientId: patient.id })));
    const subscriberId = mappingResults[0].subscriber.subscriberId;
    assert.match(subscriberId, /^cdx-sub-[a-f0-9-]{36}$/);
    assert.ok(mappingResults.every(result => result.subscriber.subscriberId === subscriberId));
    assert.equal(await prisma.externalReference.count({ where: { provider: 'novu', entityType: 'NOVU_SUBSCRIBER', internalId: patient.id } }), 1);
    const verified = await operator.runNovuOperatorCommand(session, { action: 'verify-subscriber', clinicId: scope.clinicId, patientId: patient.id });
    assert.equal(verified.subscriber.verified, true);
    await assert.rejects(operator.getNovuOperatorWorkspace({ ...session, organizationId: 'other-org',
      roleAssignments: [{ role: 'OWNER', organizationId: 'other-org', clinicId: null }] }, scope.clinicId, patient.id), { code: 'novu-patient-not-found' });
    await assert.rejects(operator.runNovuOperatorCommand(session, { action: 'test', clinicId: scope.clinicId, patientId: patient.id }), { code: 'novu-synthetic-test-only' });
    const notifications = load('src/lib/notifications.ts', { ...mocks,
      '@/lib/env': { notificationDeliveryMode: () => 'novu', notificationBatchLimit: () => 10 },
      '@/lib/application/integrations/novu-delivery': delivery });
    const notificationData = { ...scope, patientId: patient.id, channel: 'EMAIL', status: 'SCHEDULED', recipient: patient.email, body: 'PRIVATE must never leave the application' };
    const notification = await prisma.notification.create({ data: notificationData }); loseResponse = false;
    const workerResults = await Promise.all([notifications.processDueNotifications(), notifications.processNotificationNow(notification.id), notifications.processDueNotifications()]);
    assert.equal(sends, 2, JSON.stringify(workerResults)); assert.equal(workerResults.reduce((sum, value) => sum + value.sent, 0), 0);
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status, 'PROCESSING');
    const pending = await prisma.externalReference.findFirstOrThrow({ where: { internalId: notification.id, provider: 'novu', entityType: 'NOVU_DELIVERY' } });
    const otherPatient = await prisma.patient.create({ data: { ...scope, fullName: 'Other synthetic patient', phone: '0000000001', medicalAlerts: [] } });
    await assert.rejects(operator.runNovuOperatorCommand(session, { action: 'reconcile', clinicId: scope.clinicId,
      patientId: otherPatient.id, deliveryId: pending.id }), { code: 'novu-delivery-not-found' });
    await operator.runNovuOperatorCommand(session, { action: 'reconcile', clinicId: scope.clinicId, patientId: patient.id, deliveryId: pending.id });
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } })).status, 'SENT');
    await notifications.processNotificationNow(notification.id); assert.equal(sends, 2);
    const credential = await prisma.notification.create({ data: { ...notificationData, templateKey: 'PASSWORD_RESET' } });
    await notifications.processNotificationNow(credential.id, { subject: 'Synthetic setup', body: 'Fresh ephemeral credential' });
    await notifications.processDueNotifications(); assert.equal(sends, 2);
    console.log('Novu native operator/worker: three-worker stable mapping, explicit patient verification/scope, batch/immediate claim race, PROCESSING until reconciliation, confirmed SENT, credential exclusion passed');
    execFileSync(process.execPath, ['scripts/audit-concurrency.cjs'], { cwd: require('node:path').resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'inherit', timeout: 60000, windowsHide: true });
  } finally {
    await prisma?.$disconnect();
    await Promise.all(clients.map(client => client.end().catch(() => {})));
    if (created) { await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]); await admin.query(`DROP DATABASE "${name}"`); }
    await admin.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

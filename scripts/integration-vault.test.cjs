const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('./audit-source-loader.cjs');
const file = 'src/infrastructure/integrations/credential-vault.ts';
const scope = { organizationId: 'org-A', connectionId: 'connection-A', provider: 'payos' };
const secrets = { clientId: 'synthetic-client', apiKey: 'synthetic-private-api', checksumKey: 'synthetic-private-checksum' };
function vault(env = {}, secret = 'synthetic-stable-auth-master-20261105') {
  return load(file, { '@/lib/env': { authSecret: typeof secret === 'function' ? secret : () => secret } },
    { process: { env }, Object, JSON });
}
const api = vault();
const plain = value => JSON.parse(JSON.stringify(value));

test('real AES-GCM round trips UTF-8, empty and null-prototype dictionaries with random nonces', () => {
  for (const value of [secrets, {}, { unicode: 'Tiếng Việt 🔐', empty: '' }, Object.assign(Object.create(null), secrets)]) {
    const first = api.sealIntegrationSecrets(scope, value), second = api.sealIntegrationSecrets(scope, value);
    assert.notEqual(first, second);
    const [version, nonce, body, tag] = first.split('.');
    assert.equal(version, 'v1'); assert.equal(Buffer.from(nonce, 'base64url').length, 12);
    assert.equal(Buffer.from(tag, 'base64url').length, 16); assert.ok(body);
    assert.deepEqual(plain(api.openIntegrationSecrets(scope, first)), plain(value));
    for (const secret of Object.values(secrets)) assert.ok(!first.includes(secret));
  }
});

test('fixed master uses the specified HKDF namespace and authenticated scope tuple', () => {
  const master = Buffer.alloc(32, 23), env = { INTEGRATION_SECRET_KEY: master.toString('base64') };
  const configured = vault(env, () => { throw new Error('Auth fallback must not be consulted'); });
  const sealed = configured.sealIntegrationSecrets(scope, secrets);
  const [, nonce, body, tag] = sealed.split('.').map((part, index) => index ? Buffer.from(part, 'base64url') : part);
  const key = Buffer.from(crypto.hkdfSync('sha256', master, 'codexdentist/integration-credentials/v1', 'credential-vault/aes-256-gcm', 32));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(JSON.stringify(['codexdentist/integration-credentials/v1', scope.organizationId, scope.connectionId, scope.provider])));
  decipher.setAuthTag(tag);
  assert.deepEqual(JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString()), secrets);
  assert.deepEqual(plain(configured.openIntegrationSecrets(scope, sealed)), secrets);
});

test('AAD binds organization, connection and provider without delimiter ambiguity', () => {
  const sealed = api.sealIntegrationSecrets(scope, secrets);
  for (const other of [{ ...scope, organizationId: 'org-B' }, { ...scope, connectionId: 'connection-B' }, { ...scope, provider: 'documenso' }]) {
    assert.throws(() => api.openIntegrationSecrets(other, sealed), /integration-secrets-invalid/);
  }
  const ambiguous = { organizationId: 'a:b', connectionId: 'c', provider: 'payos' };
  assert.throws(() => api.openIntegrationSecrets({ ...ambiguous, organizationId: 'a', connectionId: 'b:c' }, api.sealIntegrationSecrets(ambiguous, secrets)), /integration-secrets-invalid/);
});

test('tag, nonce and ciphertext tampering fail closed; key changes cannot decrypt', () => {
  const sealed = api.sealIntegrationSecrets(scope, secrets);
  for (const index of [1, 2, 3]) {
    const pieces = sealed.split('.'), bytes = Buffer.from(pieces[index], 'base64url'); bytes[0] ^= 1;
    pieces[index] = bytes.toString('base64url');
    assert.throws(() => api.openIntegrationSecrets(scope, pieces.join('.')), /integration-secrets-invalid/);
  }
  assert.throws(() => vault({}, 'another-stable-auth-master').openIntegrationSecrets(scope, sealed), /integration-secrets-invalid/);
  const first = vault({ INTEGRATION_SECRET_KEY: Buffer.alloc(32, 1).toString('base64') });
  assert.throws(() => vault({ INTEGRATION_SECRET_KEY: Buffer.alloc(32, 2).toString('base64') }).openIntegrationSecrets(scope, first.sealIntegrationSecrets(scope, secrets)), /integration-secrets-invalid/);
});

test('optional key must be exactly canonical 32-byte base64; invalid configuration never falls back', () => {
  for (const key of ['', ' ', 'not-base64', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), Buffer.alloc(32).toString('base64') + '\n']) {
    assert.throws(() => vault({ INTEGRATION_SECRET_KEY: key }).sealIntegrationSecrets(scope, secrets), /integration-secrets-key-invalid/);
  }
  assert.throws(() => vault({}, () => { throw new Error(secrets.apiKey); }).sealIntegrationSecrets(scope, secrets), error => {
    assert.equal(error.message, 'integration-secrets-key-invalid'); assert.equal(error.cause, undefined); return true;
  });
});

test('strict bounded envelopes reject version, encoding, sizes, truncation and trailing data', () => {
  const sealed = api.sealIntegrationSecrets(scope, secrets);
  for (const malformed of [null, '', secrets.apiKey, sealed.replace('v1.', 'v2.'), sealed + '.', ' ' + sealed, sealed + '=', sealed.slice(0, -2), 'v1.' + 'a'.repeat(45000), sealed.replace(/\.[^.]+$/, '.AA')]) {
    assert.throws(() => api.openIntegrationSecrets(scope, malformed), /integration-secrets-invalid/);
  }
});

test('valid field limits round trip and noncanonical base64url pad bits fail closed', () => {
  const value = Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['field' + i, i ? 'value' : 'x'.repeat(8192)]));
  const encoded = api.sealIntegrationSecrets(scope, value);
  assert.deepEqual(plain(api.openIntegrationSecrets(scope, encoded)), value);
  const pieces = encoded.split('.'), tag = pieces[3], alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  pieces[3] = tag.slice(0, -1) + alphabet[alphabet.indexOf(tag.at(-1)) + 1];
  assert.deepEqual(Buffer.from(pieces[3], 'base64url'), Buffer.from(tag, 'base64url'));
  assert.throws(() => api.openIntegrationSecrets(scope, pieces.join('.')), /integration-secrets-invalid/);
});

test('bounded string dictionaries reject non-data properties, prototypes and fractional shapes without invoking getters', () => {
  let invoked = false;
  const accessor = Object.defineProperty({}, 'apiKey', { enumerable: true, get() { invoked = true; throw new Error(secrets.apiKey); } });
  const inputs = [null, [], 'secret', { key: 1 }, { key: null }, new (class Credentials { constructor() { this.key = 'value'; } })(), accessor,
    { ['__proto__']: 'value' }, { [Symbol('secret')]: 'value' }, { ['a'.repeat(129)]: 'x' }, { key: 'a'.repeat(8193) },
    Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['key' + i, 'x'])), Object.fromEntries(Array.from({ length: 5 }, (_, i) => ['key' + i, 'x'.repeat(8192)]))];
  for (const input of inputs) assert.throws(() => api.sealIntegrationSecrets(scope, input), /integration-secrets-invalid/);
  assert.equal(invoked, false);
  for (const other of [null, { ...scope, provider: '' }, { ...scope, connectionId: 'x'.repeat(257) }, { ...scope, organizationId: 'org\0A' }]) {
    assert.throws(() => api.sealIntegrationSecrets(other, secrets), /integration-secrets-invalid/);
  }
});

test('authenticated but invalid plaintext shapes are rejected after decryption', () => {
  const key = Buffer.from(crypto.hkdfSync('sha256', 'synthetic-stable-auth-master-20261105', 'codexdentist/integration-credentials/v1', 'credential-vault/aes-256-gcm', 32));
  for (const value of ['[]', '{"apiKey":123}', 'null', '{"__proto__":"x"}', 'not-json']) {
    const nonce = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(['codexdentist/integration-credentials/v1', ...Object.values(scope)])));
    const body = Buffer.concat([cipher.update(value), cipher.final()]);
    assert.throws(() => api.openIntegrationSecrets(scope, ['v1', nonce.toString('base64url'), body.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.')), /integration-secrets-invalid/);
  }
});

test('repository writes actual sealed payload with parameterized scope and atomic marker update', async () => {
  const calls = [], db = { async $queryRawUnsafe(sql, ...params) { calls.push({ sql, params }); return [{ id: scope.connectionId }]; } };
  await api.writeIntegrationSecrets(db, scope, secrets);
  assert.equal(calls.length, 1);
  const { sql, params } = calls[0];
  assert.deepEqual(params.slice(0, 3), [scope.connectionId, scope.organizationId, scope.provider]);
  assert.match(sql, /FOR UPDATE/); assert.match(sql, /ON CONFLICT/); assert.match(sql, /"secretRef"='vault:v1'/);
  for (const value of [...Object.values(secrets), ...Object.values(scope)]) assert.ok(!sql.includes(value));
  assert.deepEqual(plain(api.openIntegrationSecrets(scope, params[3])), secrets);
});

test('repository reads require matching connection scope; missing claimed vault never falls back', async () => {
  const sealed = api.sealIntegrationSecrets(scope, secrets);
  const db = result => ({ async $queryRawUnsafe(sql, ...params) {
    assert.match(sql, /c\."provider"=\$3/); assert.match(sql, /s\."organizationId"=c\."organizationId"/);
    assert.deepEqual(params, [scope.connectionId, scope.organizationId, scope.provider]); return result;
  } });
  assert.deepEqual(plain(await api.readIntegrationSecrets(db([{ ciphertext: sealed, secretRef: 'vault:v1' }]), scope)), secrets);
  assert.equal(await api.readIntegrationSecrets(db([{ ciphertext: null, secretRef: 'legacy-env' }]), scope), null);
  await assert.rejects(api.readIntegrationSecrets(db([]), scope), /integration-connection-not-found/);
  await assert.rejects(api.readIntegrationSecrets(db([{ ciphertext: null, secretRef: 'vault:v1' }]), scope), /integration-secrets-missing/);
  await assert.rejects(api.readIntegrationSecrets(db([{ ciphertext: sealed + 'x', secretRef: 'vault:v1' }]), scope), /integration-secrets-invalid/);
  await assert.rejects(api.writeIntegrationSecrets({ async $queryRawUnsafe() { return []; } }, scope, secrets), /integration-connection-not-found/);
});

test('repository failures expose only safe codes without driver errors, causes or plaintext', async () => {
  const db = { async $queryRawUnsafe() { throw new Error(secrets.apiKey); } };
  for (const promise of [api.writeIntegrationSecrets(db, scope, secrets), api.readIntegrationSecrets(db, scope)]) {
    await assert.rejects(promise, error => {
      assert.equal(error.message, 'integration-secrets-storage-unavailable'); assert.equal(error.cause, undefined);
      assert.ok(!error.stack.includes(secrets.apiKey)); return true;
    });
  }
});

test('native PostgreSQL: full migration, vault isolation, tenant FK, UTC, rotation, concurrency and cascade',
  { skip: process.env.INTEGRATION_VAULT_POSTGRES !== '1' }, async () => {
    const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
    assert.ok(process.env.NODE_ENV === 'test' && url && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      ![...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service|user|password|connectionstring)$/i.test(key)), 'Native vault regression requires an explicit loopback test admin database');
    const { Client } = require('pg'), { execFileSync } = require('node:child_process');
    const name = 'integration_vault_test_' + crypto.randomBytes(8).toString('hex');
    const target = new URL(url); target.pathname = '/' + name;
    const admin = new Client({ connectionString: url.toString() });
    let created = false;
    const clients = [];
    const executor = client => ({ $queryRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rows,
      $executeRawUnsafe: async (sql, ...params) => (await client.query(sql, params)).rowCount });
    try {
      await admin.connect();
      assert.match(name, /^integration_vault_test_[a-f0-9]{16}$/);
      await admin.query(`CREATE DATABASE "${name}"`); created = true;
      execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: require('node:path').resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: target.toString() }, stdio: 'pipe', timeout: 60000,
      });
      for (let i = 0; i < 2; i++) { const client = new Client({ connectionString: target.toString() }); clients.push(client); await client.connect(); }
      const [client, other] = clients, db = executor(client);
      await client.query("SET TIME ZONE 'Asia/Ho_Chi_Minh'");
      await client.query(`INSERT INTO "Organization" (id,name,"updatedAt") VALUES ('org-A','Synthetic A',now()),('org-B','Synthetic B',now())`);
      await client.query(`INSERT INTO "IntegrationConnection" (id,"organizationId",provider,metadata) VALUES
        ('connection-A','org-A','payos','{"label":"public"}'),('connection-B','org-B','documenso','{}')`);
      assert.equal(await api.readIntegrationSecrets(db, scope), null);
      await api.writeIntegrationSecrets(db, scope, secrets);
      assert.deepEqual(plain(await api.readIntegrationSecrets(db, scope)), secrets);
      const stored = (await client.query(`SELECT s.*, c."secretRef", c.metadata,
        abs(extract(epoch from (s."createdAt"-(clock_timestamp() AT TIME ZONE 'UTC')))) < 5 AS utc
        FROM "IntegrationCredential" s JOIN "IntegrationConnection" c ON c.id=s."connectionId" WHERE c.id='connection-A'`)).rows[0];
      assert.equal(stored.utc, true); assert.equal(stored.secretRef, 'vault:v1'); assert.deepEqual(stored.metadata, { label: 'public' });
      for (const value of Object.values(secrets)) assert.ok(!JSON.stringify(stored).includes(value));
      for (const invalidScope of [{ ...scope, organizationId: 'org-B' }, { ...scope, provider: 'documenso' },
        { ...scope, connectionId: 'absent' }, { ...scope, provider: "payos' OR TRUE--" }]) {
        await assert.rejects(api.readIntegrationSecrets(db, invalidScope), /integration-connection-not-found/);
        await assert.rejects(api.writeIntegrationSecrets(db, invalidScope, { apiKey: 'must-not-write' }), /integration-connection-not-found/);
      }
      const second = { organizationId: 'org-B', connectionId: 'connection-B', provider: 'documenso' };
      await client.query(`INSERT INTO "IntegrationCredential" ("connectionId","organizationId",ciphertext) VALUES ('connection-B','org-B',$1)`, [stored.ciphertext]);
      await assert.rejects(api.readIntegrationSecrets(db, second), /integration-secrets-invalid/);
      await api.writeIntegrationSecrets(db, second, secrets);
      await assert.rejects(client.query(`UPDATE "IntegrationCredential" SET "organizationId"='org-B' WHERE "connectionId"='connection-A'`), error => error.code === '23503');
      await assert.rejects(client.query(`UPDATE "IntegrationConnection" SET "organizationId"='org-B' WHERE id='connection-A'`), error => error.code === '23503');
      await Promise.all([api.writeIntegrationSecrets(db, scope, { apiKey: 'rotation-one' }), api.writeIntegrationSecrets(executor(other), scope, { apiKey: 'rotation-two' })]);
      assert.ok(['rotation-one', 'rotation-two'].includes((await api.readIntegrationSecrets(db, scope)).apiKey));
      const rotated = (await client.query(`SELECT "createdAt", "updatedAt" >= "createdAt" AS ordered FROM "IntegrationCredential" WHERE "connectionId"='connection-A'`)).rows[0];
      assert.equal(rotated.createdAt.getTime(), stored.createdAt.getTime()); assert.equal(rotated.ordered, true);
      const before = await api.readIntegrationSecrets(db, scope);
      await client.query('BEGIN'); await api.writeIntegrationSecrets(db, scope, { apiKey: 'rolled-back' }); await client.query('ROLLBACK');
      assert.deepEqual(plain(await api.readIntegrationSecrets(db, scope)), plain(before));
      await client.query(`UPDATE "IntegrationCredential" SET ciphertext='v1.corrupt' WHERE "connectionId"='connection-A'`);
      await assert.rejects(api.readIntegrationSecrets(db, scope), /integration-secrets-invalid/);
      await client.query(`DELETE FROM "IntegrationCredential" WHERE "connectionId"='connection-A'`);
      await assert.rejects(api.readIntegrationSecrets(db, scope), /integration-secrets-missing/);
      await api.writeIntegrationSecrets(db, scope, secrets);
      await client.query(`DELETE FROM "IntegrationConnection" WHERE id='connection-A'`);
      assert.equal((await client.query(`SELECT count(*)::int AS count FROM "IntegrationCredential" WHERE "connectionId"='connection-A'`)).rows[0].count, 0);
      const migrations = require('node:fs').readdirSync(require('node:path').join(__dirname, '../prisma/migrations'), { withFileTypes: true })
        .filter(entry => entry.isDirectory() && require('node:fs').existsSync(require('node:path').join(__dirname, '../prisma/migrations', entry.name, 'migration.sql')));
      assert.equal((await client.query(`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`)).rows[0].count, migrations.length);
    } finally {
      await Promise.all(clients.map(client => client.end()));
      if (created) { assert.match(name, /^integration_vault_test_[a-f0-9]{16}$/); await admin.query(`DROP DATABASE "${name}"`); }
      await admin.end();
    }
  });

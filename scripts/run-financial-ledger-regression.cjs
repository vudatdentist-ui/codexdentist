const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

const source = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !source ||
    !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) {
  throw new Error('Financial regression runner requires an explicit loopback test database.');
}
const name = 'financial_ledger_test_' + randomBytes(8).toString('hex');
const target = new URL(source);
target.pathname = '/' + name;
const pool = new Pool({ connectionString: source.toString(), max: 1 });
function child(script, args, env) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env });
  if (result.error || result.status !== 0) throw new Error('Financial regression subprocess failed.');
}
(async () => {
  let created = false;
  try {
    await pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    const env = { ...process.env, DATABASE_URL: target.toString(), FINANCIAL_LEDGER_DISPOSABLE: '1' };
    child(require.resolve('prisma/build/index.js'), ['migrate', 'deploy'], env);
    child('scripts/financial-ledger-postgres.cjs', [], env);
  } finally {
    // This name is generated here, never accepted from the environment or CLI.
    if (created && /^financial_ledger_test_[a-f0-9]{16}$/.test(name) && target.pathname === '/' + name) {
      await pool.query(`DROP DATABASE "${name}"`);
    }
    await pool.end();
  }
})().catch(() => { console.error('Disposable financial ledger verification failed.'); process.exitCode = 1; });

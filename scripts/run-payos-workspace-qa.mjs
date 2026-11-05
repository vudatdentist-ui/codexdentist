// Full app QA uses a loopback development server and a synthetic merchant.
// Production's HTTPS provider requirement remains in force, without TLS overrides.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const database = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !database || !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
    [...database.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) {
  throw new Error('payOS browser QA requires an explicit disposable loopback database');
}
const app = 'http://127.0.0.1:3001', merchant = 'http://127.0.0.1:11444';
const env = { ...process.env, APP_BASE_URL: app, PAYOS_DEFAULT_BASE_URL: merchant,
  PAYOS_QA_APP_URL: app, PAYOS_QA_PROVIDER_URL: merchant };
const children = [], files = [];
mkdirSync('output/workspace-qa/payos', { recursive: true });
function start(args, name, childEnv) {
  const fd = openSync(`output/workspace-qa/payos/${name}.log`, 'w'); files.push(fd);
  const child = spawn(process.execPath, args, { env: childEnv, stdio: ['ignore', fd, fd], windowsHide: true });
  children.push(child); return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error(`QA process exited before readiness: ${url}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(1000);
  }
  throw new Error(`QA process did not become ready: ${url}`);
}
try {
  execFileSync(process.execPath, ['scripts/fetch-font-assets.mjs'], { env, stdio: 'inherit', windowsHide: true });
  // Refuse to reuse an unrelated server on either test port.
  for (const url of [app, merchant]) {
    let occupied = false;
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch {}
    if (occupied) throw new Error(`QA port already in use: ${url}`);
  }
  const provider = start(['scripts/payos-test-server.cjs'], 'merchant', { ...env, NODE_ENV: 'test' });
  await ready(`${merchant}/__test/state`, provider);
  const server = start(['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3001'], 'app', { ...env, NODE_ENV: 'development' });
  await ready(`${app}/api/health`, server);
  const qa = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-transform-types',
    '--experimental-loader', './scripts/ts-alias-loader.mjs', 'scripts/payos-workspace-qa.mjs'],
    { env: { ...env, NODE_ENV: 'test' }, stdio: 'inherit', windowsHide: true });
  children.push(qa);
  process.exitCode = await new Promise((resolve, reject) => { qa.once('error', reject); qa.once('exit', code => resolve(code ?? 1)); });
} finally {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null ? null : new Promise(resolve => child.once('exit', resolve))));
  for (const fd of files) closeSync(fd);
}

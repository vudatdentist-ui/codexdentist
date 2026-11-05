import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const database = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
if (process.env.NODE_ENV !== 'test' || !database || !['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname) ||
    [...database.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) throw new Error('Requires an explicit disposable loopback test database');
const app = 'http://127.0.0.1:3002', provider = 'http://127.0.0.1:11445';
const env = { ...process.env, APP_BASE_URL: app, DOCUMENSO_QA_APP_URL: app,
  DOCUMENSO_DEFAULT_BASE_URL: provider, PATIENT_FILE_STORAGE_DRIVER: 'local' };
const children = [], files = [];
mkdirSync('output/workspace-qa/documenso', { recursive: true });
function start(args, name, mode) {
  const fd = openSync(`output/workspace-qa/documenso/${name}.log`, 'w'); files.push(fd);
  const child = spawn(process.execPath, args, { env: { ...env, NODE_ENV: mode }, stdio: ['ignore', fd, fd], windowsHide: true });
  children.push(child); return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (child.exitCode !== null) throw new Error(`Process exited before readiness: ${url}`);
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return; } catch {}
    await delay(1000);
  }
  throw new Error(`Process did not become ready: ${url}`);
}
try {
  execFileSync(process.execPath, ['scripts/fetch-font-assets.mjs'], { env, stdio: 'inherit', windowsHide: true });
  for (const url of [app, provider]) {
    let occupied = false; try { await fetch(url, { signal: AbortSignal.timeout(1000) }); occupied = true; } catch {}
    if (occupied) throw new Error(`Test port already in use: ${url}`);
  }
  const engine = start(['scripts/documenso-test-server.cjs'], 'provider', 'test'); await ready(`${provider}/__test/state`, engine);
  const server = start(['node_modules/next/dist/bin/next', 'dev', '--webpack', '-H', '127.0.0.1', '-p', '3002'], 'app', 'development');
  await ready(`${app}/api/health`, server);
  const qa = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--experimental-transform-types',
    '--experimental-loader', './scripts/ts-alias-loader.mjs', 'scripts/documenso-workspace-qa.mjs'],
    { env: { ...env, NODE_ENV: 'test' }, stdio: 'inherit', windowsHide: true }); children.push(qa);
  process.exitCode = await new Promise((resolve, reject) => { qa.once('error', reject); qa.once('exit', code => resolve(code ?? 1)); });
} finally {
  for (const child of children.reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await Promise.all(children.map(child => child.exitCode !== null ? null : new Promise(resolve => child.once('exit', resolve))));
  for (const fd of files) closeSync(fd);
}

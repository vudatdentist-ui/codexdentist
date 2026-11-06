// Mount the actual React component independently while parent composition lands.
// HTTP uses the actual route/commands/adapters with only session, SQL and provider
// I/O replaced by synthetic boundaries. No Next build or shared build artifacts.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require('playwright');
const { fixture } = require('./chatwoot-test-fixture.cjs');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'output/chatwoot-ui');
async function main() {
  fs.mkdirSync(output, { recursive: true });
  function transpile(source, target) {
    const code = ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), { fileName: source,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    fs.writeFileSync(path.join(output, target), code.replace('./ChatwootPatientConversation.module.css', './styles.cjs'));
  }
  transpile('src/workspaces/integrations/ChatwootPatientConversation.tsx', 'component.cjs');
  transpile('src/features/integrations/chatwoot-workspace.ts', 'workspace.cjs');
  const css = fs.readFileSync(path.join(root, 'src/workspaces/integrations/ChatwootPatientConversation.module.css'), 'utf8');
  fs.writeFileSync(path.join(output, 'styles.cjs'), 'module.exports=' + JSON.stringify(Object.fromEntries([...css.matchAll(/\.([A-Za-z][A-Za-z0-9_]*)/g)].map(match => [match[1], match[1]]))));
  fs.writeFileSync(path.join(output, 'entry.cjs'), `const React=require('react');const {createRoot}=require('react-dom/client');const {ChatwootPatientConversation}=require('./component.cjs');
    const root=createRoot(document.getElementById('root'));window.mount=(patientId='patient',language='en')=>root.render(React.createElement(React.StrictMode,null,React.createElement(ChatwootPatientConversation,{patientId,language})));window.mount();`);
  const webpack = require('next/dist/compiled/webpack/webpack').webpack;
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, target: 'web',
    entry: path.join(output, 'entry.cjs'), output: { path: output, filename: 'bundle.js' },
    resolve: { alias: { '@/features/integrations/chatwoot-workspace': path.join(output, 'workspace.cjs') }, modules: [path.join(root, 'node_modules'), 'node_modules'] },
  }, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  let active = fixture();
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const request = new Request(`http://127.0.0.1${req.url}`, { method: req.method, ...(req.method === 'POST' ? { body } : {}) });
        const response = await active.route[req.method](request);
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(output, 'bundle.js'))); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#eef4f4;font:15px/1.5 Arial,sans-serif}main{max-width:780px;margin:28px auto;padding:12px}${css}</style><main id="root"></main><script src="/bundle.js"></script></html>`);
    } catch { res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const evidence = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      async function capture(state) {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${state}: overflow at ${width}`);
        const file = `${state}-${width}.png`; await page.screenshot({ path: path.join(output, file), fullPage: true }); evidence.push(file);
      }
      active = fixture(); await page.goto(origin); await page.getByText('No conversation linked', { exact: true }).waitFor();
      await capture('empty');
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Prepare link to an existing contact' }).click();
      await page.getByText('Link using verified IDs', { exact: true }).waitFor();
      assert.equal(active.provider.contacts.length, 0); assert.equal(active.provider.conversations.length, 0);
      await page.getByText('Link using verified IDs', { exact: true }).click(); await capture('prepared');
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Create or continue link' }).click();
      await page.getByText('Link saved', { exact: true }).waitFor(); assert.equal(active.provider.contacts.length, 1); assert.equal(active.provider.conversations.length, 1);
      await capture('saved');
      const link = page.getByRole('link', { name: 'Open in Chatwoot' }); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
      await page.reload(); await page.getByText('Link saved', { exact: true }).waitFor();
      active = fixture(); active.provider.loseConversation = true; await page.reload(); await page.getByText('No conversation linked', { exact: true }).waitFor();
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Create or continue link' }).click();
      await page.getByText('Result not yet confirmed', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Refresh status' }).click();
      await page.getByRole('button', { name: 'Check result in Chatwoot' }).waitFor();
      await page.getByText('Link using verified IDs', { exact: true }).click(); await page.getByLabel('Chatwoot contact ID', { exact: true }).fill('10');
      await capture('unknown-manual-link');
      await page.getByRole('button', { name: 'Check result in Chatwoot' }).click(); await page.getByText('Link saved', { exact: true }).waitFor();
      assert.equal(active.provider.conversations.length, 1);
      active.controls.configured = false; await page.reload(); await page.getByText('Chatwoot is disabled for this clinic', { exact: true }).waitFor(); await capture('disabled');
      active = fixture({ session: { role: 'DENTIST', roles: ['DENTIST'] } }); await page.reload();
      await page.getByText('Only owners and front desk staff can manage conversations', { exact: true }).waitFor(); await capture('permission');
      active = fixture(); await page.reload(); await page.getByText('No conversation linked', { exact: true }).waitFor();
      await page.getByRole('checkbox').check(); await page.evaluate(() => window.mount('other', 'vi'));
      await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('checkbox').count(), 0, 'Different patient must discard old draft');
      await page.evaluate(() => window.mount('patient', 'vi')); await page.getByText('Chưa liên kết hội thoại', { exact: true }).waitFor();
      assert.equal(await page.getByRole('checkbox').isChecked(), false); await capture('vietnamese');
      assert.deepEqual(errors, []); await page.close();
    }
    fs.writeFileSync(path.join(output, 'evidence.json'), JSON.stringify({ runtime: 'Isolated actual React component with actual route/commands; synthetic I/O', evidence }, null, 2));
    console.log(`Chatwoot UI QA passed: ${evidence.length} screenshots; StrictMode, create/reload/recovery, patient switch, disabled/permission; 1440/390/320px.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

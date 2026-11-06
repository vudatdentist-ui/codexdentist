// Synthetic loopback app: real React panels, actual routes/commands and local
// qrcode encoder; only database/vault persistence I/O is replaced. No bank I/O.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { webpack, LimitChunkCountPlugin } = require('next/dist/compiled/webpack/webpack');
const { chromium } = require('playwright');
const { harness } = require('./bank-transfer-harness.cjs');
const root = process.cwd(), out = path.join(root, 'output/bank-transfer-qa');
fs.mkdirSync(out, { recursive: true });
const cssPath = path.join(root, 'src/workspaces/integrations/PayOSWorkspace.module.css').replaceAll('\\', '/');
for (const [name, file] of [['invoice', 'src/workspaces/integrations/BankTransferInvoicePayment.tsx'], ['settings', 'src/workspaces/integrations/BankTransferSettingsPanel.tsx'], ['bank-domain', 'src/domains/revenue/bank-transfer.ts']]) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    .replace('./PayOSWorkspace.module.css', cssPath).replace('@/domains/revenue/bank-transfer', './bank-domain');
  fs.writeFileSync(path.join(out, `${name}.js`), js);
}
fs.writeFileSync(path.join(out, 'css-loader.cjs'), `module.exports=function(source){ const keys=[...source.matchAll(/\\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(m=>m[1]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source)+';document.head.appendChild(style);module.exports='+JSON.stringify(Object.fromEntries(keys.map(k=>[k,k])))+';'; };`);
fs.writeFileSync(path.join(out, 'entry.js'), `import React from'react';import{createRoot}from'react-dom/client';import{BankTransferInvoicePayment}from'./invoice';import{BankTransferSettingsPanel}from'./settings';const root=createRoot(document.getElementById('app'));window.showScreen=(screen='settings',props={})=>root.render(screen==='settings'?React.createElement(BankTransferSettingsPanel,{language:'vi',...props}):React.createElement(BankTransferInvoicePayment,{patientId:'patient-a',invoiceNo:'HD-001',balance:150000,language:'vi',...props}));window.showScreen();`);

(async () => {
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry: path.join(out, 'entry.js'),
    output: { path: out, filename: 'bundle.js' }, resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'] },
    plugins: [new LimitChunkCountPlugin({ maxChunks: 1 })],
    module: { rules: [{ test: /\.css$/, use: [path.join(out, 'css-loader.cjs')] }] },
  }, (err, stats) => err || stats.hasErrors() ? reject(err || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const h = harness({ noConnection: true }); let requests = 0, delayNext = false, release;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/api/')) {
        requests++; let text = ''; for await (const chunk of req) text += chunk;
        if (delayNext && req.url.endsWith('/qr')) { delayNext = false; await new Promise(resolve => { release = resolve; }); }
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method,
          headers: req.headers, ...(req.method !== 'GET' ? { body: text } : {}) });
        const route = req.url.endsWith('/settings') ? h.routes.settings : h.routes.qr;
        const response = await route[req.method](request);
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
      }
      if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(out, 'bundle.js'))); return; }
      res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline bank transfer QA</title><style>body{margin:0;background:#f2f1e9;font-family:Arial,sans-serif}main{max-width:780px;margin:24px auto;padding:12px}*{box-sizing:border-box}</style><main id="app"></main><script src="/bundle.js"></script></html>');
    } catch (error) { res.writeHead(500); res.end('Synthetic QA failure'); console.error(error); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('data:')) external.push(request.url()); });
    await page.goto(origin); await page.getByLabel('Mã BIN ngân hàng (6 chữ số)').waitFor();
    assert.equal(await page.getByLabel('Số tài khoản', { exact: true }).inputValue(), '');
    assert.equal(await page.getByRole('button', { name: 'Lưu tài khoản', exact: true }).isDisabled(), true);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(out, `settings-empty-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    // Synthetic fixture configuration exists only inside this loopback process.
    await page.getByLabel('Mã BIN ngân hàng (6 chữ số)').fill('970436');
    await page.getByLabel('Số tài khoản', { exact: true }).fill('000000000000');
    await page.getByLabel('Tên người nhận theo ngân hàng').fill('SYNTHETIC TEST ONLY');
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Lưu tài khoản', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'chưa được xác minh tự động' }).waitFor();
    assert.equal(await page.getByLabel('Số tài khoản', { exact: true }).inputValue(), '');
    await page.screenshot({ path: path.join(out, 'settings-saved-320.png'), fullPage: true });
    assert.equal(h.state.writes[0].lastVerifiedAt, null);
    await page.evaluate(() => window.showScreen('invoice'));
    await page.getByRole('button', { name: 'Tạo QR chuyển khoản', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'chưa xác nhận thanh toán' }).waitFor();
    assert.match(await page.getByRole('img').getAttribute('src'), /^data:image\/png;base64,/);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: path.join(out, `invoice-qr-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    const amountInput = page.getByLabel('Số tiền chuyển (VND)');
    await amountInput.fill('150001'); assert.equal(await page.getByRole('img').count(), 0);
    assert.ok(await page.getByRole('button', { name: 'Tạo QR chuyển khoản', exact: true }).isDisabled());
    await amountInput.fill('100000'); h.state.invoice.paidAmount = '199999.00';
    await page.getByRole('button', { name: 'Tạo QR chuyển khoản', exact: true }).click(); await page.getByRole('alert').waitFor();
    assert.equal(await page.getByRole('img').count(), 0); await page.screenshot({ path: path.join(out, 'balance-changed-320.png'), fullPage: true });
    h.state.invoice.paidAmount = '50000.00';
    await page.evaluate(() => window.showScreen('invoice', { language: 'en', invoiceNo: 'HD-002' }));
    await page.getByRole('button', { name: 'Generate transfer QR', exact: true }).waitFor();
    await page.screenshot({ path: path.join(out, 'invoice-english-320.png'), fullPage: true });
    await page.evaluate(() => window.showScreen('invoice', { invoiceNo: 'HD-001' }));
    delayNext = true; const pending = page.waitForRequest(r => r.url().endsWith('/qr'));
    await page.getByRole('button', { name: 'Tạo QR chuyển khoản', exact: true }).click(); await pending;
    await page.evaluate(() => window.showScreen('invoice', { patientId: 'other-patient' }));
    await page.getByRole('button', { name: 'Tạo QR chuyển khoản', exact: true }).waitFor({ state: 'visible' });
    await page.waitForTimeout(50); release(); await page.waitForTimeout(100);
    assert.equal(await page.getByRole('img').count(), 0);
    assert.equal(h.state.writes.length, 1, 'QR never writes financial or account state');
    assert.ok(requests >= 5); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    console.log('PASS synthetic loopback React + actual routes/commands: account save, local PNG QR, scope switch, stale balance, vi/en, 1440/390/320; zero external requests');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

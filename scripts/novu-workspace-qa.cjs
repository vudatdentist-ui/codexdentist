// Render the actual React panel and product CSS without a shared Next build.
// Only API I/O is replaced by owned synthetic fixtures on an ephemeral loopback port.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const { chromium } = require('playwright');
const output = path.resolve('output/workspace-qa/novu');
fs.mkdirSync(output, { recursive: true });
const panel = fs.readFileSync('src/workspaces/integrations/NovuNotificationPanel.tsx', 'utf8');
const css = fs.readFileSync('src/workspaces/integrations/PayOSWorkspace.module.css', 'utf8');
const classes = Object.fromEntries([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g)].map(match => [match[1], match[1]]));
const compiled = ts.transpileModule(panel, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
fs.writeFileSync(path.join(output, 'panel.cjs'), compiled.replace('./PayOSWorkspace.module.css', './styles.cjs'));
fs.writeFileSync(path.join(output, 'styles.cjs'), `module.exports=${JSON.stringify(classes)};`);
fs.writeFileSync(path.join(output, 'entry.cjs'), `const React=require('react');const {createRoot}=require('react-dom/client');const {NovuNotificationPanel}=require('./panel.cjs');
  const patient=new URLSearchParams(location.search).has('patient');createRoot(document.getElementById('root')).render(React.createElement(NovuNotificationPanel,{clinicId:'synthetic-clinic',language:'vi',...(patient?{patientId:'synthetic-patient'}:{})}));`);
const runCompiler = () => new Promise((resolve, reject) => webpack({ mode: 'production', entry: path.join(output, 'entry.cjs'),
  output: { path: output, filename: 'bundle.js' }, optimization: { minimize: false }, devtool: false,
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString('errors-only'))) : resolve()));
(async () => {
  await runCompiler();
  let state = { subscriber: null, deliveries: [] }, fail = false, posts = 0;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript'); return response.end(fs.readFileSync(path.join(output, 'bundle.js'))); }
    if (url.pathname === '/style.css') { response.setHeader('Content-Type', 'text/css'); return response.end(css); }
    if (url.pathname.startsWith('/api/integrations/novu/operator')) {
      response.setHeader('Content-Type', 'application/json'); response.setHeader('Cache-Control', 'no-store');
      if (fail) { response.writeHead(503); return response.end('{}'); }
      if (request.method === 'POST') {
        let raw = ''; for await (const chunk of request) raw += chunk;
        const body = JSON.parse(raw); posts++;
        assert.equal(body.clinicId, 'synthetic-clinic');
        if (body.action === 'test') state.deliveries = [{ id: 'synthetic-delivery', synthetic: true, state: 'UNCERTAIN' }];
        else if (body.action === 'reconcile') state.deliveries[0].state = 'SENT';
        else if (body.action === 'allocate-subscriber') state.subscriber = { subscriberId: 'cdx-sub-00000000-1111-2222-3333-444444444444', verified: false };
        else if (body.action === 'verify-subscriber') state.subscriber.verified = true;
        else throw new Error('Unexpected command');
      }
      return response.end(JSON.stringify(state));
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end('<!doctype html><html lang="vi"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;padding:16px;background:#f5f5ef;font-family:Arial,sans-serif}main{max-width:1000px;margin:auto}</style><main id="root"></main><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(); const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(origin); await page.getByRole('button', { name: 'Gửi thử nghiệm', exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `operator-ready-${width}.png`) });
    }
    await page.getByRole('button', { name: 'Gửi thử nghiệm', exact: true }).click();
    await page.getByText('Cần đối soát', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Gửi thử nghiệm', exact: true }).isDisabled(), true);
    await page.screenshot({ path: path.join(output, 'operator-uncertain-320.png') });
    await page.getByRole('button', { name: 'Kiểm tra kết quả gửi', exact: true }).click();
    await page.getByText('Đã gửi', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'operator-sent-320.png') });
    state = { subscriber: null, deliveries: [] };
    await page.goto(`${origin}/?patient`); await page.getByRole('button', { name: 'Tạo mã người nhận', exact: true }).click();
    await page.getByText('Chờ xác minh người nhận', { exact: true }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.screenshot({ path: path.join(output, `patient-mapping-${width}.png`) });
    }
    await page.getByRole('button', { name: 'Xác minh người nhận', exact: true }).click();
    await page.getByText('Đã xác minh người nhận', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'patient-verified-320.png') });
    fail = true; await page.getByRole('button', { name: 'Tải lại', exact: true }).click();
    await page.getByRole('alert').waitFor(); await page.screenshot({ path: path.join(output, 'load-error-320.png') });
    assert.equal(posts, 4); assert.deepEqual(errors, []);
    console.log('Novu actual React panel: operator test/uncertain/reconcile/SENT, explicit patient allocate/verify, error state and 1440/390/320px overflow passed');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

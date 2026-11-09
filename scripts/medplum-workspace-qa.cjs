// Isolated real React panel with synthetic API responses; no clinic database.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { webpack } = require('next/dist/compiled/webpack/webpack');
const { chromium } = require('playwright');
const root = process.cwd(), out = path.join(root, 'output/medplum-qa');
fs.mkdirSync(out, { recursive: true });
const cssPath = path.join(root, 'src/workspaces/integrations/PayOSWorkspace.module.css').replaceAll('\\', '/');
const component = ts.transpileModule(fs.readFileSync('src/workspaces/integrations/MedplumPatientExport.tsx', 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText.replace('./PayOSWorkspace.module.css', cssPath);
fs.writeFileSync(path.join(out, 'component.js'), component);
fs.writeFileSync(path.join(out, 'css-loader.cjs'), `module.exports=function(source){ const keys=[...source.matchAll(/\\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map(m=>m[1]);return 'const style=document.createElement("style");style.textContent='+JSON.stringify(source)+';document.head.appendChild(style);module.exports='+JSON.stringify(Object.fromEntries(keys.map(k=>[k,k])))+';'; };`);
fs.writeFileSync(path.join(out, 'entry.js'), `import React from 'react';import{createRoot}from'react-dom/client';import{MedplumPatientExport}from'./component';const root=createRoot(document.getElementById('app'));window.showPatient=(patientId='synthetic-a',language='vi')=>root.render(React.createElement(MedplumPatientExport,{patientId,language}));window.showPatient();`);

(async () => {
  await new Promise((resolve, reject) => webpack({ mode: 'development', devtool: false, entry: path.join(out, 'entry.js'),
    output: { path: out, filename: 'bundle.js' }, resolve: { modules: [path.join(root, 'node_modules'), 'node_modules'] },
    module: { rules: [{ test: /\.css$/, use: [path.join(out, 'css-loader.cjs')] }] },
  }, (err, stats) => err || stats.hasErrors() ? reject(err || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
  const server = http.createServer((req, res) => {
    if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(out, 'bundle.js'))); }
    else res.end('<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Medplum panel QA</title><style>body{margin:0;background:#f2f1e9;font-family:Arial,sans-serif}main{max-width:780px;margin:32px auto;padding:12px}*{box-sizing:border-box}</style><main id="app"></main><script src="/bundle.js"></script></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    let status = 'NEVER', attempts = 0, delay = false, release;
    await page.route('**/api/integrations/medplum/patients/**', async route => {
      const post = route.request().method() === 'POST';
      if (post && delay) await new Promise(resolve => { release = resolve; });
      if (post) { status = 'VERIFIED'; attempts++; }
      await route.fulfill({ json: { status, attempts, lastAttemptAt: attempts ? '2026-11-06T12:00:00Z' : null,
        lastVerifiedAt: attempts ? '2026-11-06T12:00:00Z' : null, errorCode: status === 'RETRY' ? 'medplum-provider-unavailable' : null } });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByRole('status').filter({ hasText: 'Chưa gửi' }).waitFor();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page.screenshot({ path: path.join(out, `never-${width}.png`), fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.getByRole('button', { name: 'Gửi đến Medplum' }).click();
    await page.getByRole('status').filter({ hasText: 'Đã xác minh bản hiện tại' }).waitFor();
    await page.screenshot({ path: path.join(out, 'verified-320.png'), fullPage: true });
    for (const [value, label] of [['RETRY', 'Chưa xác minh'], ['SOURCE_CHANGED', 'Hồ sơ đã thay đổi'], ['PENDING', 'Đang gửi']]) {
      status = value; await page.getByRole('button', { name: 'Kiểm tra lại' }).click();
      await page.getByRole('status').filter({ hasText: label }).waitFor();
      await page.screenshot({ path: path.join(out, `${value.toLowerCase()}-320.png`), fullPage: true });
    }
    await page.route('**/api/integrations/medplum/patients/synthetic-error', r => r.fulfill({ status: 403, json: { error: 'medplum-export-denied' } }));
    await page.evaluate(() => window.showPatient('synthetic-error'));
    await page.getByRole('alert').waitFor(); await page.screenshot({ path: path.join(out, 'error-320.png'), fullPage: true });
    status = 'NEVER'; attempts = 0;
    await page.evaluate(() => window.showPatient('synthetic-b', 'en'));
    await page.getByRole('status').filter({ hasText: 'Not sent' }).waitFor();
    await page.screenshot({ path: path.join(out, 'english-320.png'), fullPage: true });
    delay = true; await page.getByRole('button', { name: 'Export to Medplum' }).click();
    await page.waitForFunction(() => document.querySelector('button').disabled);
    await Promise.all([page.waitForResponse(response => response.url().endsWith('/synthetic-c')),
      page.evaluate(() => window.showPatient('synthetic-c', 'en'))]);
    await page.getByRole('status').filter({ hasText: 'Not sent' }).waitFor();
    release(); await page.waitForTimeout(100);
    assert.match(await page.getByRole('status').innerText(), /Not sent/);
    assert.deepEqual(errors, []); console.log('PASS isolated Medplum React UI: vi/en, 1440/390/320, export/refresh/retry/pending/error/source change, patient switch during flight');
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

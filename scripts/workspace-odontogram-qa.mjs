import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loginForBrowserAudit } from './browser-login.mjs';

const baseUrl = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const output = 'output/workspace-qa/odontogram';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(15000);
const results = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const editor = page.locator('.patient-odontogram-editor');
const chart = editor.locator('[class*="_chartPanel_"]');
const inspector = editor.locator('aside');
try {
  await loginForBrowserAudit(page, { baseUrl,
    email: process.env.BROWSER_QA_EMAIL ?? 'owner@nhavista.vn',
    password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!',
    evidencePath: `${output}/login-failure` });
  await page.goto(`${baseUrl}/patients`, { waitUntil: 'networkidle' });
  await page.locator('.patient-layout .table-row').first().click();
  await page.waitForURL(url => Boolean(url.searchParams.get('patientId')));
  const patientId = new URL(page.url()).searchParams.get('patientId');
  await page.goto(`${baseUrl}/journey?patientId=${encodeURIComponent(patientId)}`, { waitUntil: 'networkidle' });
  await editor.waitFor({ state: 'visible' });
  for (const width of [1920, 1440, 1100, 820, 390, 320]) {
    try {
      await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const layout = await editor.evaluate(root => {
        const chart = root.querySelector('[class*="_chartPanel_"]');
        const inspector = root.querySelector('aside');
        return { chart: chart.getBoundingClientRect().toJSON(), inspector: inspector.getBoundingClientRect().toJSON(),
          chartScrollWidth: chart.scrollWidth, chartClientWidth: chart.clientWidth,
          chartOverflow: getComputedStyle(chart).overflowX,
          viewport: innerWidth, documentWidth: document.documentElement.scrollWidth };
      });
      assert.ok(layout.chart.right <= layout.inspector.left + 2 || layout.chart.bottom <= layout.inspector.top + 2,
        `The tooth chart must never overlap its inspector: ${JSON.stringify(layout)}`);
      assert.ok(layout.documentWidth <= width + 2, 'Only the chart may scroll horizontally, never the whole page');
      assert.equal(await chart.locator('button[aria-label^="Ch\u1ecdn r\u0103ng "]').count(), 32,
        'The CSS integration must retain every permanent FDI tooth');
      if (layout.chartScrollWidth > layout.chartClientWidth + 2) {
        assert.equal(layout.chartOverflow, 'auto', 'Narrow charts must expose their off-screen teeth');
      }
      const tooth = chart.getByRole('button', { name: 'Ch\u1ecdn r\u0103ng 28', exact: true });
      await chart.locator('button[aria-label^="Ch\u1ecdn r\u0103ng "]').first().focus();
      await tooth.focus();
      assert.ok(await tooth.evaluate(node => {
        const tooth = node.getBoundingClientRect();
        const chart = node.closest('[class*="_chartPanel_"]').getBoundingClientRect();
        return tooth.left >= chart.left - 2 && tooth.right <= chart.right + 2;
      }), 'Keyboard focus must reveal an off-screen FDI tooth');
      if (await tooth.getAttribute('aria-pressed') !== 'true') await tooth.press('Enter');
      await chart.locator('button[aria-label="Ch\u1ecdn r\u0103ng 28"][aria-pressed=true]').waitFor();
      assert.ok((await inspector.innerText()).includes('28'), 'Selection must reach the clinical inspector');
      await editor.screenshot({ path: `${output}/chart-${width}.png` });
      await page.locator('#chart-odontogram').evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: `${output}/chart-viewport-${width}.png` });
      results.push({ width, status: 'passed', layout });
    } catch (error) {
      results.push({ width, status: 'failed', error: String(error) });
      await page.screenshot({ path: `${output}/failure-${width}.png`, fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
} catch (error) {
  results.push({ status: 'failed', error: String(error) });
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ output, results }, null, 2));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

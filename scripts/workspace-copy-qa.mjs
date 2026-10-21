import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loginForBrowserAudit } from './browser-login.mjs';

const base = new URL(process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) {
  throw new Error('Workspace copy QA must use an isolated loopback server.');
}
const output = 'output/workspace-qa/copy-audit';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const results = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function settle(target = page) {
  await target.waitForLoadState('networkidle');
  await target.evaluate(() => document.fonts.ready);
}
async function check(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) {
    results.push({ name, status: 'failed', message: String(error) });
    await page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
const routes = ['dashboard', 'patients', 'journey', 'schedule', 'billing', 'accounting', 'services', 'staff', 'crm', 'inventory', 'pharmacy', 'forms', 'learning', 'employee-app', 'reports', 'community', 'patient-app', 'settings'];

try {
  for (const width of [1440, 390, 320]) {
    await check(`Authentication headings contain no slogan/subtitle at ${width}px`, async () => {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      for (const route of ['login', 'signup']) {
        assert.equal((await page.goto(new URL(`/${route}`, base).href)).status(), 200);
        await settle();
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.locator('.login-story, .workspace-caption').count(), 0);
        const subtitleCount = await page.locator('h1').evaluate(heading => {
          return [...heading.parentElement.children].filter(node => ['P', 'SPAN', 'OL'].includes(node.tagName)).length;
        });
        assert.equal(subtitleCount, 0, 'No explanatory copy beside the auth heading');
        const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }));
        assert.ok(geometry.width <= geometry.viewport + 1, 'Auth page must not overflow');
        assert.ok(await page.locator('input[type=email]').first().isVisible());
        assert.ok(await page.locator('input[type=password]').first().isVisible());
        if (route === 'signup') {
          assert.equal(await page.locator('input[name=password]').getAttribute('minlength'), '12');
          assert.equal(await page.locator('input[name=passwordConfirmation]').getAttribute('minlength'), '12');
          assert.match(await page.locator('main').innerText(), /30 ng\u00e0y/);
        }
        await page.screenshot({ path: `${output}/${route}-${width}.png`, fullPage: true });
      }
    });
  }
  await check('Login error and password recovery remain available', async () => {
    await page.goto(new URL('/login?error=invalid', base).href); await settle();
    const error = page.locator('.login-panel').getByRole('alert');
    assert.equal(await error.count(), 1);
    assert.ok(await error.isVisible());
    assert.ok((await error.innerText()).length > 0);
    await page.locator('.forgot-password-panel summary').click();
    assert.ok(await page.locator('.forgot-password-panel input[type=email]').isVisible());
    await page.screenshot({ path: `${output}/login-error-and-recovery-320.png`, fullPage: true });
  });
  await page.goto(new URL('/login', base).href);
  await loginForBrowserAudit(page, {
    baseUrl: base.origin, email: process.env.BROWSER_QA_EMAIL ?? 'owner@nhavista.vn',
    password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!', evidencePath: `${output}/login-failure`,
  });
  for (const language of ['vi', 'en']) {
    await page.locator('.language-switch').getByRole('button', { name: language.toUpperCase(), exact: true }).click();
    await page.waitForFunction(language => document.documentElement.lang === language, language);
    for (const width of [1440, 390]) for (const route of routes) {
      await check(`${route}: title-only heading in ${language} at ${width}px`, async () => {
        await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        assert.equal((await page.goto(new URL(`/${route}`, base).href)).status(), 200);
        await page.locator('.workspace-page-heading').waitFor(); await settle();
        assert.equal(await page.locator('.workspace-page-heading > *').count(), 1);
        assert.equal(await page.locator('.workspace-page-heading > h1').count(), 1);
        assert.equal(await page.locator('.workspace-purpose, .workspace-page-heading .workspace-chapter').count(), 0);
        assert.equal(await page.locator('.workspace-brand span').count(), 0);
        const heading = await page.locator('h1').innerText();
        assert.ok(heading.trim());
        const expected = {
          patients: { vi: 'H\u1ed3 s\u01a1 b\u1ec7nh nh\u00e2n', en: 'Patient records' },
          journey: { vi: 'H\u00e0nh tr\u00ecnh \u0111i\u1ec1u tr\u1ecb', en: 'Care journey' },
          schedule: { vi: 'L\u1ecbch h\u1eb9n', en: 'Appointments' },
          billing: { vi: 'Thanh to\u00e1n', en: 'Payments' },
          dashboard: { vi: 'H\u00f4m nay', en: 'Today' },
        };
        if (expected[route]) assert.equal(heading, expected[route][language]);
        if (route === 'dashboard') {
          assert.equal(await page.locator('.day-section-heading p, .day-scope-note').count(), 0);
          assert.ok((await page.locator('[data-day-total]').innerText()).trim());
        }
        if (route === 'journey') {
          assert.equal(await page.locator('[data-patient-selection-state] p').count(), 0);
          assert.equal(await page.locator('[data-patient-selection-state] h2').count(), 1);
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `${output}/${route}-${language}-${width}.png` });
      });
    }
  }
  await check('No unhandled browser exceptions during copy QA', async () => assert.deepEqual(errors, []));
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, capturedAt: new Date().toISOString(), results, errors }, null, 2));
  await context.close(); await browser.close();
}
console.log(JSON.stringify({ output, results }, null, 2));
if (results.some(result => result.status === 'failed')) process.exitCode = 1;

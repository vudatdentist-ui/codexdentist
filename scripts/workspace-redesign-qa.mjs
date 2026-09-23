import { loginForBrowserAudit } from './browser-login.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const output = 'output/workspace-qa/review';
await mkdir(output, { recursive: true });
// Preserve the exact vendor layout contract for screenshot-driven integration review.
await writeFile(`${output}/odontogram-vendor.css`, await readFile(new URL(import.meta.resolve('codexdentist-odontogram/style.css')), 'utf8'));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const results = [], errors = [], externalFonts = [], fontEvidence = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/fonts\.(googleapis|gstatic)\.com/.test(request.url())) externalFonts.push(request.url()); });
async function settled() {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function goto(route) {
  const response = await page.goto(`${base}/${route}`);
  assert.equal(response.status(), 200, route);
  await page.locator('.story-topbar').waitFor({ state: 'visible' });
  await settled();
}
async function shot(name, fullPage = true) {
  await settled();
  const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 2, `${name}: horizontal overflow ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: `${output}/${name}.png`, fullPage });
}
async function check(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) {
    results.push({ name, status: 'failed', message: String(error) });
    await page.locator('#typography-probe').evaluateAll(nodes => nodes.forEach(node => node.remove())).catch(() => {});
    await page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
async function modalKeyboard(dialog, trigger) {
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press(index < 12 ? 'Tab' : 'Shift+Tab');
    assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)), 'Focus escaped the operational dialog');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await trigger.evaluate(node => node === document.activeElement), 'Dialog must return focus');
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
}
try {
  await loginForBrowserAudit(page, { baseUrl: base,
    email: process.env.BROWSER_QA_EMAIL ?? 'owner@nhavista.vn',
    password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!',
    evidencePath: `${output}/login-failure` });
  await goto('dashboard');
  await page.locator('.language-switch').getByRole('button', { name: 'VI', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'vi');

  await check('Vietnamese glyphs use the actual self-hosted body and editorial fonts, including decomposed accents', async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
    const sample = 'Ti\u1ebfp t\u1ee5c ch\u0103m s\u00f3c \u0111\u1ec3 ng\u01b0\u1eddi b\u1ec7nh y\u00ean t\u00e2m. \u0103 \u00e2 \u0111 \u00ea \u00f4 \u01a1 \u01b0 \u1eef \u1ed7 \u1ef5 \u1ea5 \u1eab \u1ed9 \u1ec7';
    for (const [kind, weight] of [['body', 400], ['body', 700], ['editorial', 400]]) {
      await page.evaluate(async ({ kind, weight, sample }) => {
        const probe = document.createElement('span'); probe.id = 'typography-probe';
        probe.textContent = `${sample} ${sample.toUpperCase()} ${sample.normalize('NFD')}`;
        const target = kind === 'body' ? document.body : document.querySelector('h1');
        probe.style.cssText = 'position:fixed;left:0;bottom:0;opacity:0;pointer-events:none;white-space:nowrap;max-width:1px;overflow:hidden;font-size:24px;line-height:2';
        probe.style.fontFamily = getComputedStyle(target).fontFamily.split(',')[0]; probe.style.fontWeight = String(weight);
        document.body.append(probe);
        await document.fonts.load(`${weight} 24px ${probe.style.fontFamily}`, probe.textContent);
      }, { kind, weight, sample });
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#typography-probe' });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      fontEvidence.push({ kind, weight, fonts });
      assert.ok(fonts.length > 0, 'Browser must report fonts that actually shaped glyphs');
      assert.ok(fonts.every(font => font.isCustomFont && (kind === 'body' ? /Be.?Vietnam.?Pro/i : /Noto.?Serif/i).test(font.familyName)), JSON.stringify(fonts));
      await page.locator('#typography-probe').evaluate(node => node.remove());
    }
    await cdp.detach();
  });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const route of ['dashboard', 'patients', 'schedule', 'journey', 'billing', 'accounting', 'services', 'staff', 'crm', 'inventory', 'pharmacy', 'forms', 'learning', 'employee-app', 'reports', 'settings', 'community', 'patient-app']) {
      await check(`Vietnamese ${route} at ${width}px`, async () => {
        await goto(route);
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.locator('.source-badge:visible').count(), 0);
        await shot(`vi-${route}-${width}`);
        const tabs = page.locator('.workspace-tabs').first();
        if (await tabs.count()) {
          const enabled = tabs.locator('[role=tab]:not([disabled])');
          if (await enabled.count() > 1) {
            const current = tabs.locator('[role=tab][aria-selected=true]');
            await current.focus(); await page.keyboard.press('End');
            assert.equal(await enabled.last().getAttribute('aria-selected'), 'true');
            assert.ok(await enabled.last().evaluate(node => node === document.activeElement));
            await page.keyboard.press('Home');
            assert.equal(await enabled.first().getAttribute('aria-selected'), 'true');
            await page.keyboard.press('ArrowLeft');
            assert.equal(await enabled.last().getAttribute('aria-selected'), 'true');
            await page.keyboard.press('Home');
            assert.equal(await tabs.locator('[role=tab][tabindex="0"]').count(), 1);
          }
        }
      });
    }
  }

  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const route of ['patients', 'schedule', 'accounting', 'crm', 'services', 'inventory', 'pharmacy', 'forms', 'learning', 'settings']) {
    await check(`Native ${route} dialog, keyboard and mobile form`, async () => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await goto(route);
      const selector = '.workspace-actions button.primary-button[type=button]:visible:not(:disabled), .service-action-row button.primary-button[type=button]:visible:not(:disabled), .toolbar-actions button.primary-button[type=button]:visible:not(:disabled)';
      if (route === 'accounting') await page.locator('.accounting-section-tabs button').last().click();
      const trigger = page.locator(route === 'accounting'
        ? '.accounting-budget-summary button:not(:disabled)'
        : route === 'forms' ? '.toolbar-actions > button.secondary-button:not(:disabled)' : selector).first();
      assert.ok(await trigger.count(), `${route}: expected a create or assign control`);
      await trigger.click(); const dialog = page.locator('dialog.operational-dialog[open]');
      await dialog.waitFor({ state: 'visible' });
      assert.ok(await dialog.evaluate(node => node.matches(':modal')), 'Must be in the browser top layer, not a painted overlay');
      await shot(`dialog-${route}-1440`, false);
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(`dialog-${route}-390`, false);
      const clipped = await dialog.evaluate(node => node.scrollWidth > node.clientWidth + 2);
      assert.equal(clipped, false, `${route}: dialog content overflows horizontally`);
      await modalKeyboard(dialog, trigger);
      await page.setViewportSize({ width: 1440, height: 1000 });
    });
  }

  await check('Create and reopen a Vietnamese patient record; preserve patient identity through the care journey', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await goto('patients');
    await page.locator('.service-action-row button.primary-button').first().click();
    const dialog = page.locator('dialog.operational-dialog[open]');
    const name = `Ki\u1ec3m th\u1eed giao di\u1ec7n Vi\u1ec7t ${Date.now()}`;
    await dialog.locator('input[name=fullName]').fill(name);
    await dialog.locator('input[name=phone]').fill(`090${String(Date.now()).slice(-7)}`);
    await dialog.locator('input[name=email]').fill(`ui-${Date.now()}@example.invalid`);
    await dialog.locator('button[type=submit]').click();
    await dialog.waitFor({ state: 'hidden' });
    const row = page.locator('.patient-layout .table-row').filter({ hasText: name });
    await row.waitFor({ state: 'visible' }); await row.click();
    await page.waitForURL(url => Boolean(url.searchParams.get('patientId')));
    const id = new URL(page.url()).searchParams.get('patientId');
    await page.reload(); await settled();
    assert.ok((await page.locator('.patient-dossier-heading').innerText()).includes(name));
    await page.locator('.patient-edit-action').click();
    assert.equal(await page.locator('dialog[open] input[name=fullName]').inputValue(), name);
    await modalKeyboard(page.locator('dialog[open]'), page.locator('.patient-edit-action'));
    assert.equal(await page.locator('.patient-card').evaluate(node => node.scrollHeight > node.clientHeight + 2), false, 'The dossier must not clip its actions inside a nested scroll region');
    await shot('vi-patient-dossier-1440');
    await page.locator('.patient-quick-actions a[href^="/journey?"]').click();
    await page.waitForURL(url => url.pathname === '/journey' && url.searchParams.get('patientId') === id);
    await page.locator('.record-section-nav').waitFor({ state: 'visible' });
    await settled();
    const chartLink = page.locator('.record-section-nav a[href="#chart-odontogram"]');
    await chartLink.click();
    await page.waitForURL(url => url.hash === '#chart-odontogram');
    await shot('vi-record-chart-1440', false);
    const geometry = await page.locator('.patient-odontogram-editor').evaluate(root => [...root.querySelectorAll('div,section,aside,img')].filter((node, index, nodes) => node.tagName === 'ASIDE' || nodes.findIndex(other => other.className === node.className) === index).map(node => {
      const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return { tag: node.tagName, className: node.className, x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display, columns: style.gridTemplateColumns, overflow: style.overflow, font: style.fontFamily };
    }));
    await writeFile(`${output}/odontogram-layout.json`, JSON.stringify(geometry, null, 2));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.patient-odontogram-editor').scrollIntoViewIfNeeded();
    await shot('vi-record-chart-390', false);
    await goto(`patients?patientId=${encodeURIComponent(id)}`);
    await page.locator('.patient-dossier-heading').scrollIntoViewIfNeeded();
    await shot('vi-patient-dossier-390', false);
  });

  await check('320px text and narrow-form layout', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await goto('patients'); await shot('vi-patients-320');
    await page.locator('.service-action-row button.primary-button').first().click();
    await shot('vi-create-patient-320', false);
    await page.keyboard.press('Escape');
  });
  await check('No unhandled browser exceptions or browser font-CDN requests', async () => {
    assert.deepEqual(errors, []); assert.deepEqual(externalFonts, []);
  });
} catch (error) {
  results.push({ name: 'Browser setup', status: 'failed', message: String(error) });
  await page.screenshot({ path: `${output}/setup-failure.png`, fullPage: true }).catch(() => {});
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors, externalFonts, fontEvidence }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ output, results }, null, 2));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

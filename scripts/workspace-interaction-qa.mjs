import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loginForBrowserAudit } from './browser-login.mjs';

const base = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const output = 'output/workspace-qa/interaction-audit';
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
async function visit(route, width = 1440) {
  await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
  assert.equal((await page.goto(`${base}/${route}`)).status(), 200);
  await page.locator('.story-topbar').waitFor();
  await settle();
}
async function check(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) {
    results.push({ name, status: 'failed', message: String(error) });
    await page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
try {
  await loginForBrowserAudit(page, {
    baseUrl: base, email: process.env.BROWSER_QA_EMAIL ?? 'owner@nhavista.vn',
    password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!', evidencePath: `${output}/login`,
  });
  await page.locator('.language-switch').getByRole('button', { name: 'VI', exact: true }).click();

  await check('Patient search supports ArrowDown, Enter, Escape and an associated listbox', async () => {
    await visit('journey');
    const input = page.locator('.patient-search-combobox input');
    await input.fill('nguyen');
    const first = page.locator('.patient-search-option').first();
    await first.waitFor();
    const expectedName = await first.locator('strong').innerText();
    await page.screenshot({ path: `${output}/patient-search-open.png` });
    await input.press('ArrowDown');
    assert.equal(await input.getAttribute('role'), 'combobox');
    const listId = await input.getAttribute('aria-controls');
    const activeId = await input.getAttribute('aria-activedescendant');
    assert.ok(listId && activeId, 'Input must identify its listbox and keyboard-active option');
    assert.equal(await page.locator(`[id="${listId}"]`).getAttribute('role'), 'listbox');
    assert.equal(await page.locator(`[id="${activeId}"]`).getAttribute('aria-selected'), 'true');
    assert.ok(await input.evaluate(node => node === document.activeElement));
    await input.press('Enter');
    await page.waitForURL(url => url.pathname === '/journey' && Boolean(url.searchParams.get('patientId')));
    await settle();
    assert.ok((await input.inputValue()).includes(expectedName));
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    await input.fill('le');
    await page.locator('.patient-search-results').waitFor();
    await input.press('Escape');
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    assert.equal(await input.inputValue(), 'le', 'Escape dismisses results without destroying the query');
  });

  await check('Patient-directory search selection opens the intended persistent record', async () => {
    await visit('patients');
    const input = page.locator('.patient-search-combobox input');
    await input.fill('nguyen');
    const option = page.locator('.patient-search-option').first();
    const name = await option.locator('strong').innerText();
    await option.click();
    await page.screenshot({ path: `${output}/directory-selection.png` });
    await page.waitForURL(url => url.pathname === '/patients' && Boolean(url.searchParams.get('patientId')), { timeout: 12000 });
    await settle();
    assert.equal(await page.locator('.patient-dossier-heading h2').innerText(), name);
    const id = new URL(page.url()).searchParams.get('patientId');
    await page.reload(); await settle();
    assert.equal(new URL(page.url()).searchParams.get('patientId'), id);
    assert.equal(await page.locator('.patient-dossier-heading h2').innerText(), name);
    await page.screenshot({ path: `${output}/directory-record-reopened.png` });
  });

  await check('Patient drawer is a native modal with keyboard containment and focus return', async () => {
    await visit('journey', 390);
    const trigger = page.locator('.journey-patient-menu-trigger');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Menu b\u1ec7nh nh\u00e2n', exact: true });
    await dialog.waitFor();
    await page.screenshot({ path: `${output}/patient-drawer-390.png` });
    assert.ok(await dialog.evaluate(node => node.matches('dialog:modal')), 'aria-modal alone does not make background content inert');
    assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
    for (let i = 0; i < 28; i++) {
      await page.keyboard.press(i < 14 ? 'Tab' : 'Shift+Tab');
      assert.ok(await dialog.evaluate(node => node.contains(document.activeElement)), 'Focus escaped the patient drawer');
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.ok(await trigger.evaluate(node => node === document.activeElement));
    assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  });

  await check('Mobile patient directory has no oversized empty dossier or hidden list scroll', async () => {
    for (const width of [320, 390, 820]) {
      await visit('patients', width);
      const empty = page.locator('.patient-layout .patient-card');
      const list = page.locator('.patient-layout .table-list');
      await page.screenshot({ path: `${output}/patients-empty-${width}.png`, fullPage: true });
      assert.ok((await empty.boundingBox()).height < 180, 'Unselected dossier should be an instruction, not a 520px empty panel');
      assert.ok(await list.evaluate(node => node.scrollHeight <= node.clientHeight + 2), 'Unselected mobile list must use document scrolling');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    }
  });

  await check('Blocked local storage never crashes the signed-in workspace', async () => {
    const restricted = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 } });
    const restrictedPage = await restricted.newPage();
    const faults = [];
    restrictedPage.on('pageerror', error => faults.push(error.message));
    await restricted.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Storage blocked for audit', 'SecurityError'); } });
    });
    try {
      await restrictedPage.goto(`${base}/dashboard`);
      await settle(restrictedPage);
      await restrictedPage.screenshot({ path: `${output}/storage-blocked.png` });
      assert.deepEqual(faults, [], 'Preferences are optional, not a requirement for patient work');
      await restrictedPage.locator('.language-switch').getByRole('button', { name: 'EN', exact: true }).click({ timeout: 12000 });
      assert.equal(await restrictedPage.locator('html').getAttribute('lang'), 'en');
      assert.deepEqual(faults, []);
    } finally { await restricted.close(); }
  });

  await check('Blocked session storage does not prevent opening and editing a form', async () => {
    const restricted = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 } });
    const restrictedPage = await restricted.newPage();
    const faults = [];
    restrictedPage.on('pageerror', error => faults.push(error.message));
    await restricted.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('Storage blocked for audit', 'SecurityError'); } });
    });
    try {
      await restrictedPage.goto(`${base}/patients`);
      await settle(restrictedPage);
      await restrictedPage.screenshot({ path: `${output}/session-storage-blocked.png` });
      await restrictedPage.locator('.service-action-row button.primary-button').click({ timeout: 12000 });
      const form = restrictedPage.locator('dialog[open]');
      await form.locator('input[name=fullName]').click();
      await form.locator('input[name=fullName]').fill('UI storage audit - not submitted');
      await form.locator('input[name=phone]').focus();
      assert.deepEqual(faults, []);
      await restrictedPage.screenshot({ path: `${output}/session-storage-form.png` });
      await restrictedPage.keyboard.press('Escape');
      await form.waitFor({ state: 'hidden' });
    } finally { await restricted.close(); }
  });

  await check('No unhandled exceptions in the regular interaction context', async () => assert.deepEqual(errors, []));
} catch (error) {
  results.push({ name: 'Audit setup', status: 'failed', message: String(error) });
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ output, results }, null, 2));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

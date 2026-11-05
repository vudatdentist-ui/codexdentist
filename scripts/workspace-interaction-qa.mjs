import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { loginForBrowserAudit } from './browser-login.mjs';

const base = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname) || process.env.NODE_ENV !== 'test') throw new Error('Interaction QA requires a disposable loopback test installation.');
const output = 'output/workspace-qa/interaction-audit';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const results = [];
const errors = [];
let fixturePrisma, progressFixtureId;
async function createProgressFixture() {
  const url = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL);
  if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      [...url.searchParams.keys()].some(key => /^(host|hostaddr|database|dbname|port|service)$/i.test(key))) {
    throw new Error('Journey progress fixture requires an explicit disposable loopback database.');
  }
  fixturePrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) });
  const patient = await fixturePrisma.patient.findUniqueOrThrow({ where: { id: 'patient-minh-anh' }, select: { id: true, organizationId: true, clinicId: true } });
  const id = `journey-route-${randomUUID()}`;
  await fixturePrisma.treatmentService.create({ data: { id, organizationId: patient.organizationId, clinicId: patient.clinicId,
    patientId: patient.id, serviceCode: id, serviceName: 'Synthetic route progress fixture', toothLabel: '11', teeth: ['11'], finalPrice: 100000 } });
  progressFixtureId = id;
}
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
    await page.goBack(); await settle();
    assert.equal(new URL(page.url()).searchParams.get('patientId'), null);
    assert.equal(await page.locator('.patient-dossier-heading').count(), 0, 'Back must clear the open dossier');
    assert.equal(await input.inputValue(), '', 'Back must clear the topbar selection');
    await page.goForward(); await settle();
    assert.equal(new URL(page.url()).searchParams.get('patientId'), id);
    assert.equal(await page.locator('.patient-dossier-heading h2').innerText(), name);
    await page.reload(); await settle();
    assert.equal(new URL(page.url()).searchParams.get('patientId'), id);
    assert.equal(await page.locator('.patient-dossier-heading h2').innerText(), name);
    await page.screenshot({ path: `${output}/directory-record-reopened.png` });
    await Promise.all([
      page.waitForURL(url => url.pathname === '/patients' && !url.searchParams.has('patientId')),
      page.locator('.topbar-clear-search').click(),
    ]);
    await page.locator('.patient-dossier-heading').waitFor({ state: 'detached' });
    await settle();
    assert.equal(new URL(page.url()).searchParams.get('patientId'), null, 'Clear must remove persistent patient selection');
    assert.equal(await page.locator('.patient-dossier-heading').count(), 0);
    await page.reload(); await settle();
    assert.equal(await page.locator('.patient-dossier-heading').count(), 0, 'Reload must not reopen the cleared record');
    assert.equal(await input.inputValue(), '');
    await page.screenshot({ path: `${output}/directory-selection-cleared.png` });
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

  await check('Native history mismatches hide editable Journey content, topbar and AI context; Back preserves the draft', async () => {
    await createProgressFixture();
    await visit('journey?patientId=patient-minh-anh');
    const form = page.locator('.timeline-comment-form:visible');
    await form.waitFor();
    assert.equal(await form.locator('input[name=patientId]').inputValue(), 'patient-minh-anh');
    const body = 'Synthetic unsent draft for A only';
    await form.locator('textarea[name=body]').fill(body);
    await form.locator('input[type=file]').setInputFiles({ name: 'patient-A-only.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic attachment, never submitted') });
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.getContext('2d').fillRect(0, 0, 10, 10);
      const video = document.createElement('video'); video.id = 'synthetic-record-media'; video.muted = true;
      video.srcObject = canvas.captureStream(5);
      document.querySelector('.journey-record-owner').append(video);
      await video.play();
    });
    assert.equal(await page.locator('#synthetic-record-media').evaluate(video => video.paused), false);
    await page.evaluate(() => history.pushState(null, '', '/journey?patientId=unknown-route-audit'));
    await page.getByRole('heading', { name: 'Không thể mở hồ sơ này', exact: true }).waitFor();
    assert.equal(await page.locator('.patient-chart-flow:visible, .timeline-comment-form:visible, .journey-progress-modal:visible').count(), 0);
    assert.equal(await page.locator('#synthetic-record-media').evaluate(video => video.paused), true);
    assert.equal(await page.locator('.patient-search-combobox input').inputValue(), '');
    await page.locator('.module-ai-bubble').click();
    const ai = page.locator('.module-ai-chat-form'); await ai.waitFor();
    assert.equal(await ai.locator('input[name=selectedPatientId]').inputValue(), '');
    const context = JSON.parse(await ai.locator('input[name=contextJson]').inputValue());
    assert.equal(context.selectedPatientId, null);
    assert.equal(context.selectedPatient, null);
    await page.keyboard.press('Escape');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await page.screenshot({ path: `${output}/journey-invalid-${width}.png`, fullPage: true });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
    }
    await page.goBack();
    await page.waitForURL(url => url.searchParams.get('patientId') === 'patient-minh-anh');
    await form.waitFor();
    assert.equal(await form.locator('textarea[name=body]').inputValue(), body);
    assert.equal(await form.locator('input[type=file]').evaluate(input => input.files[0]?.name), 'patient-A-only.txt');
    await page.goForward();
    await page.getByRole('heading', { name: 'Không thể mở hồ sơ này', exact: true }).waitFor();
    assert.equal(await page.locator('.timeline-comment-form:visible').count(), 0);
    await page.goBack(); await form.waitFor();
    assert.equal(await form.locator('textarea[name=body]').inputValue(), body);
    const progress = page.locator('.service-progress-cell select').first();
    const alternative = await progress.locator('option').evaluateAll(options => options.find(option => option.value !== option.parentElement.value)?.value);
    assert.ok(alternative);
    await progress.selectOption(alternative);
    await page.locator('.journey-progress-modal').waitFor();
    await page.evaluate(() => history.pushState(null, '', '/journey?patientId=unknown-route-audit'));
    await page.getByRole('heading', { name: 'Không thể mở hồ sơ này', exact: true }).waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0, 'A hidden record must leave no native modal in the top layer');
    await page.locator('.patient-search-combobox input').fill('gia han');
    await page.locator('.patient-search-option').first().waitFor();
    await page.locator('.patient-search-combobox input').press('Escape');
    assert.equal(await page.evaluate(() => document.body.style.overflow), '');
    await page.goBack(); await form.waitFor();
    assert.equal(await form.locator('textarea[name=body]').inputValue(), body);
    await page.evaluate(() => {
      const video = document.getElementById('synthetic-record-media');
      video.srcObject.getTracks().forEach(track => track.stop()); video.remove();
    });
    await page.screenshot({ path: `${output}/journey-restored-draft-320.png`, fullPage: true });
    await page.evaluate(() => history.pushState(null, '', '/journey'));
    await page.getByRole('heading', { name: 'Chọn bệnh nhân để mở bệnh án', exact: true }).waitFor();
    assert.equal(await page.locator('.timeline-comment-form:visible').count(), 0);
    assert.equal(await page.locator('.patient-search-combobox input').inputValue(), '');
    await page.goBack(); await form.waitFor();
    assert.equal(await form.locator('textarea[name=body]').inputValue(), body);
  });

  await check('Valid Journey A to B mounts a fresh owner for comments, files and pending progress', async () => {
    await visit('journey?patientId=patient-minh-anh');
    const form = page.locator('.timeline-comment-form:visible'); await form.waitFor();
    await form.locator('textarea[name=body]').fill('Synthetic unsent draft for A only');
    await form.locator('input[type=file]').setInputFiles({ name: 'patient-A-only.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic, never submitted') });
    const progress = page.locator('.service-progress-cell select').first();
    await progress.waitFor();
    const alternative = await progress.locator('option').evaluateAll(options => options.find(option => option.value !== option.parentElement.value)?.value);
    assert.ok(alternative, 'Fixture A must expose another service-progress step');
    await progress.selectOption(alternative);
    await page.locator('.journey-progress-modal').waitFor();
    assert.equal(await page.locator('.journey-progress-modal input[name=patientId]').inputValue(), 'patient-minh-anh');
    await page.evaluate(() => history.pushState(null, '', '/journey?patientId=patient-gia-han'));
    await page.waitForFunction(() => document.querySelector('.timeline-comment-form input[name=patientId]')?.value === 'patient-gia-han');
    await form.waitFor();
    assert.equal(await form.locator('textarea[name=body]').inputValue(), '');
    assert.equal(await form.locator('input[type=file]').evaluate(input => input.files.length), 0);
    assert.equal(await page.locator('.timeline-attachment-list').count(), 0);
    assert.equal(await page.locator('.journey-progress-modal').count(), 0);
    // Native history above isolates the record owner. Exercise real router/RSC
    // navigation separately so the positive case receives B's clinical data.
    await visit('journey?patientId=patient-minh-anh');
    await form.waitFor();
    await form.locator('textarea[name=body]').fill('Synthetic draft A before real navigation');
    await form.locator('input[type=file]').setInputFiles({ name: 'A-before-router.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic, never submitted') });
    const search = page.locator('.patient-search-combobox input');
    await search.fill('gia han');
    await page.locator('.patient-search-option').first().click();
    await page.waitForURL(url => url.searchParams.get('patientId') === 'patient-gia-han');
    await settle(); await form.waitFor();
    assert.equal(await form.locator('input[name=patientId]').inputValue(), 'patient-gia-han');
    assert.equal(await form.locator('textarea[name=body]').inputValue(), '');
    assert.equal(await form.locator('input[type=file]').evaluate(input => input.files.length), 0);
    await form.locator('textarea[name=body]').fill('Synthetic draft B only');
    await page.goBack();
    await page.waitForURL(url => url.searchParams.get('patientId') === 'patient-minh-anh');
    await settle(); await form.waitFor();
    assert.equal(await form.locator('input[name=patientId]').inputValue(), 'patient-minh-anh');
    assert.equal(await form.locator('textarea[name=body]').inputValue(), '');
    await page.goForward();
    await page.waitForURL(url => url.searchParams.get('patientId') === 'patient-gia-han');
    await settle(); await form.waitFor();
    assert.equal(await form.locator('input[name=patientId]').inputValue(), 'patient-gia-han');
    assert.equal(await form.locator('textarea[name=body]').inputValue(), '');
    await page.screenshot({ path: `${output}/journey-patient-B-clean-1440.png`, fullPage: true });
  });

  await check('No unhandled exceptions in the regular interaction context', async () => assert.deepEqual(errors, []));
} catch (error) {
  results.push({ name: 'Audit setup', status: 'failed', message: String(error) });
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors }, null, 2));
  await browser.close();
  try {
    if (progressFixtureId) await fixturePrisma.treatmentService.delete({ where: { id: progressFixtureId } });
  } finally { await fixturePrisma?.$disconnect(); }
  console.log(JSON.stringify({ output, results }, null, 2));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

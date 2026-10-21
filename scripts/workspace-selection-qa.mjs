import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { loginForBrowserAudit } from './browser-login.mjs';

const base = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname) || process.env.NODE_ENV !== 'test') throw new Error('Selection QA requires a disposable loopback test installation.');
const output = 'output/workspace-qa/selection-audit';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const results = [], errors = [];
const observe = target => target.on('pageerror', error => errors.push(error.message));
observe(page);
async function settle(target = page) {
  await target.waitForLoadState('networkidle');
  await target.evaluate(() => document.fonts.ready);
  await target.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function visit(route, width = 1440) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
  assert.equal((await page.goto(`${base}/${route}`)).status(), 200);
  await page.locator('.story-topbar').waitFor();
  await settle();
}
async function capture(name, target = page) {
  await settle(target);
  await target.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
async function check(name, run, target = page) {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) {
    results.push({ name, status: 'failed', message: String(error) });
    await target.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
const search = () => page.locator('.patient-search-combobox input').first();
async function selectFirstPatient() {
  await search().fill('nguyen');
  const option = page.locator('.patient-search-option').first();
  await option.waitFor();
  const name = await option.locator('strong').innerText();
  await option.click();
  await page.waitForURL(url => Boolean(url.searchParams.get('patientId')));
  await page.locator('.patient-chart-header').waitFor();
  await settle();
  return { name, id: new URL(page.url()).searchParams.get('patientId') };
}
try {
  await loginForBrowserAudit(page, { baseUrl: base, email: process.env.BROWSER_QA_EMAIL ?? 'owner@nhavista.vn', password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!', evidencePath: `${output}/login` });
  await page.locator('.language-switch').getByRole('button', { name: 'VI', exact: true }).click();
  await check('Journey distinguishes no selection from an empty authorized directory', async () => {
    await visit('journey');
    await capture('journey-unselected-1440');
    await page.getByRole('heading', { name: 'Chọn bệnh nhân để mở bệnh án', exact: true }).waitFor();
    await search().fill('nguyen');
    await page.locator('.patient-search-option').first().waitFor();
    assert.ok(await page.locator('.patient-search-option').count() > 0);
    await search().press('Escape');
    await page.setViewportSize({ width: 390, height: 844 });
    await capture('journey-unselected-390');
  });
  await check('An unknown patient link does not claim the directory is empty', async () => {
    await visit('journey?patientId=ui-audit-unavailable-id');
    await capture('journey-unavailable-link');
    await page.getByRole('heading', { name: 'Không thể mở hồ sơ này', exact: true }).waitFor();
    assert.equal(await page.locator('.patient-chart-header:visible').count(), 0);
    assert.ok(!(await page.locator('body').innerText()).includes('ui-audit-unavailable-id'));
  });
  await check('A changed patient URL cannot display the old record; returning preserves an unsent draft', async () => {
    await visit('journey');
    const { id, name } = await selectFirstPatient();
    const draft = 'Bản nháp kiểm thử chưa gửi';
    const field = page.locator('textarea[name=body]');
    await field.fill(draft);
    await page.evaluate(() => history.pushState(null, '', '/journey?patientId=ui-audit-unavailable-id'));
    await capture('journey-stale-link-hidden');
    await page.getByRole('heading', { name: 'Không thể mở hồ sơ này', exact: true }).waitFor();
    assert.equal(await page.locator('.patient-chart-header:visible').count(), 0);
    await page.evaluate(id => history.pushState(null, '', `/journey?patientId=${encodeURIComponent(id)}`), id);
    await page.locator('.patient-chart-header').waitFor();
    assert.ok((await page.locator('.patient-chart-header').innerText()).includes(name));
    assert.equal(await field.inputValue(), draft, 'Presentation must not discard an unsent draft');
    await field.fill('');
    await capture('journey-record-restored');
  });
  await check('Modified editing keys are not consumed as patient-navigation commands', async () => {
    await visit('patients');
    await search().fill('nguyen');
    await page.locator('.patient-search-option').first().waitFor();
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      const prevented = await search().evaluate((node, modifier) => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', [modifier]: true, bubbles: true, cancelable: true });
        node.dispatchEvent(event); return event.defaultPrevented;
      }, modifier);
      assert.equal(prevented, false, `${modifier}: preserve native editing behavior`);
      assert.equal(await search().getAttribute('aria-activedescendant'), null);
    }
    await search().press('ArrowDown');
    assert.ok(await search().getAttribute('aria-activedescendant'));
    await capture('lookup-keyboard');
  });
  await check('Composition events and Chromium IME input do not select a patient prematurely', async () => {
    await visit('patients');
    await search().fill('nguyen');
    await search().press('ArrowDown');
    const active = await search().getAttribute('aria-activedescendant');
    const url = page.url();
    for (const init of [{ key: 'Enter', isComposing: true }, { key: 'Escape', isComposing: true }, { key: 'Enter', keyCode: 229 }]) {
      const prevented = await search().evaluate((node, init) => {
        const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
        node.dispatchEvent(event); return event.defaultPrevented;
      }, init);
      assert.equal(prevented, false);
      assert.equal(page.url(), url);
      assert.equal(await search().getAttribute('aria-activedescendant'), active);
    }
    await search().fill('');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'Nguyễn', selectionStart: 6, selectionEnd: 6 });
    assert.equal(await search().inputValue(), 'Nguyễn');
    assert.equal(new URL(page.url()).searchParams.get('patientId'), null);
    await cdp.send('Input.insertText', { text: 'Nguyễn' });
    await cdp.detach();
    await page.locator('.patient-search-option').first().waitFor();
    await search().press('ArrowDown');
    await search().press('Enter');
    await page.waitForURL(url => Boolean(url.searchParams.get('patientId')));
    await page.locator('.patient-dossier-heading').waitFor();
    await capture('lookup-composition-committed');
  });
  for (const width of [320, 390, 620, 621, 820]) await check(`Readable organization and usable toolbar at ${width}px`, async () => {
    await visit('journey', width);
    await page.locator('.workspace-organization').evaluate(node => { node.textContent = 'Nha khoa chăm sóc gia đình Nguyễn Đình Chiểu'; });
    await capture(`toolbar-${width}`);
    const geometry = await page.locator('.workspace-utility-bar').evaluate(bar => {
      const label = bar.querySelector('.workspace-organization').getBoundingClientRect();
      const controls = bar.querySelector('.topbar-actions').getBoundingClientRect();
      return { label: { width: label.width, bottom: label.bottom }, controls: { top: controls.top }, overflow: document.documentElement.scrollWidth > innerWidth + 2 };
    });
    assert.equal(geometry.overflow, false);
    if (width <= 620) {
      assert.ok(geometry.label.width >= width - 60, 'Organization needs its own readable row');
      assert.ok(geometry.label.bottom <= geometry.controls.top + 1, 'Organization must not collide with controls');
    }
    for (const button of await page.locator('.workspace-utility-bar button:visible, .workspace-account summary').all()) {
      const rect = await button.boundingBox();
      assert.ok(rect && rect.width >= 32 && rect.height >= 40, 'Retain usable toolbar hit areas');
    }
  });
  const touch = await browser.newContext({ storageState: await context.storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const touchPage = await touch.newPage(); observe(touchPage);
  await check('Touch tapping a lookup result opens the actual record', async () => {
    await touchPage.goto(`${base}/patients`); await settle(touchPage);
    const input = touchPage.locator('.patient-search-combobox input');
    await input.tap(); await input.fill('nguyen');
    const option = touchPage.locator('.patient-search-option').first(); await option.waitFor();
    const name = await option.locator('strong').innerText();
    await capture('lookup-touch-open', touchPage);
    await option.tap();
    await touchPage.waitForURL(url => Boolean(url.searchParams.get('patientId')));
    await settle(touchPage);
    assert.equal(await touchPage.locator('.patient-dossier-heading h2').innerText(), name);
    await capture('lookup-touch-selected', touchPage);
  }, touchPage);
  await touch.close();
  await check('No unhandled exceptions in the selection test contexts', async () => assert.deepEqual(errors, []));
} catch (error) {
  results.push({ name: 'Selection test setup', status: 'failed', message: String(error) });
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, errors }, null, 2));
  await browser.close();
  console.log(JSON.stringify({ output, results }, null, 2));
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
}

import { loginForBrowserAudit } from './browser-login.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const output = 'output/workspace-qa';
const browser = await chromium.launch();
const results = [];
await mkdir(output, {recursive:true});
const context = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
async function settled() { await page.waitForLoadState('networkidle'); }
async function shot(name) {
  await settled();
  await page.evaluate(() => { window.scrollTo(0, 0); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const width = await page.evaluate(() => ({viewport:innerWidth,document:document.documentElement.scrollWidth}));
  assert.ok(width.document <= width.viewport + 2, `${name}: horizontal overflow ${JSON.stringify(width)}`);
  await page.screenshot({path:`${output}/${name}.png`, fullPage:true});
}
async function test(name, run) {
  try { await run(); results.push({name,status:'passed'}); }
  catch(error) { await page.screenshot({path:`${output}/failure-${results.length}.png`,fullPage:true}); results.push({name,status:'failed',message:String(error)}); throw error; }
}
async function closeWithEscape(dialog, trigger) {
  await dialog.waitFor({state:'visible'});
  for (let index=0;index<20;index++) {
    await page.keyboard.press(index < 10 ? 'Tab' : 'Shift+Tab');
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true, 'Modal must contain keyboard focus');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({state:'hidden'});
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true, 'Focus must return to the opener');
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden', 'Body scroll must be restored');
}
try {
  await test('Login presentation and real authentication', async () => {
    await page.goto(`${base}/login`); await shot('desktop-login');
    await page.setViewportSize({width:390,height:844}); await shot('mobile-login');
    await page.setViewportSize({width:1440,height:900});
    await loginForBrowserAudit(page, { baseUrl: base,
      email: process.env.BROWSER_QA_EMAIL ?? 'owner@nhavista.vn',
      password: process.env.BROWSER_QA_PASSWORD ?? 'CodexSmoke2026!',
      evidencePath: `${output}/login-failure` });
    await page.goto(`${base}/dashboard`); await settled();
    assert.equal(await page.locator('.narrative-day').count(),1);
  });
  await test('Vietnamese search, current destination and empty navigation state', async () => {
    const search=page.locator('.workspace-desktop-navigation input[type=search]');
    await search.fill('ho so');
    assert.equal(await page.locator('.workspace-desktop-navigation .story-nav-link').count(),1);
    assert.equal(await page.locator('.workspace-desktop-navigation .story-nav-link').getAttribute('href'),'/patients');
    await search.fill('no-such-destination');
    assert.equal(await page.locator('.workspace-desktop-navigation .story-nav-link').count(),0);
    await search.fill('');
    assert.equal(await page.locator('.workspace-desktop-navigation [aria-current=page]').getAttribute('href'),'/dashboard');
    await shot('desktop-dashboard-vi');
  });
  await test('English language, document language and persisted preference', async () => {
    await page.locator('.language-switch').getByRole('button',{name:'EN',exact:true}).click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.equal(await page.locator('h1').innerText(),'The working day');
    await shot('desktop-dashboard-en');
    await page.reload(); await settled();
    assert.equal(await page.locator('h1').innerText(),'The working day');
  });
  await test('Notification modal, read-state, filters and compose fields', async () => {
    const trigger=page.getByRole('button',{name:'Notifications and tasks',exact:true});
    await trigger.click(); const dialog=page.locator('.workspace-notifications-dialog');
    await dialog.waitFor({state:'visible'});
    if (await dialog.getByRole('button',{name:'Mark all read',exact:true}).count()) {
      await dialog.getByRole('button',{name:'Mark all read',exact:true}).click();
      await dialog.getByRole('button',{name:'Unread',exact:true}).click();
      assert.equal(await dialog.locator('.notification-row').count(),0);
    }
    await dialog.getByRole('button',{name:'Compose',exact:true}).click();
    assert.equal(await dialog.locator('input[name=subject]').count(),1);
    assert.equal(await dialog.locator('textarea[name=body]').count(),1);
    await shot('desktop-notification-compose');
    await closeWithEscape(dialog,trigger);
  });
  await test('Assistant modal keyboard behavior', async () => {
    const trigger=page.getByRole('button',{name:'Workspace assistant',exact:true});
    assert.equal(await trigger.evaluate(node => Boolean(node.closest('.workspace-utility-bar'))),true,'The assistant launcher must not float over work surfaces');
    await trigger.click(); await shot('desktop-assistant');
    await closeWithEscape(page.locator('.workspace-assistant-dialog'),trigger);
  });
  await test('Responsive menu, keyboard containment and breakpoint recovery', async () => {
    for (const width of [320,390,768,1100]) {
      await page.setViewportSize({width,height:844});
      await shot(`dashboard-${width}`);
      const controls = await page.locator('.workspace-utility-bar').evaluate(bar => {
        const selectors = ['.workspace-organization', '.language-switch button:first-child', '.language-switch button:last-child', '.workspace-assistant-slot button', '.topbar-actions > button', '.workspace-account summary'];
        return selectors.map(selector => {
          const node = bar.querySelector(selector);
          const rect = node.getBoundingClientRect();
          return {left:rect.left, right:rect.right, top:rect.top, bottom:rect.bottom, width:rect.width, height:rect.height,
            hit:selector === '.workspace-organization' || node.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))};
        });
      });
      for (let index = 1; index < controls.length; index++) {
        for (let prior = 0; prior < index; prior++) {
          const a = controls[prior], b = controls[index];
          assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `Overlapping utility controls at ${width}px`);
        }
        assert.ok(controls[index].hit, `Obscured utility control at ${width}px`);
        assert.ok(controls[index].width >= 32 && controls[index].height >= 32, 'Utility controls must retain usable hit areas');
      }
      const trigger=page.getByRole('button',{name:'Open workspace menu',exact:true});
      await trigger.click();
      const dialog=page.locator('.workspace-menu-dialog');
      await shot(`navigation-${width}`);
      await closeWithEscape(dialog,trigger);
    }
    await page.getByRole('button',{name:'Open workspace menu',exact:true}).click();
    await page.setViewportSize({width:1101,height:900});
    await page.locator('.workspace-menu-dialog').waitFor({state:'hidden'});
    assert.equal(await page.locator('.workspace-desktop-navigation').isVisible(),true);
    await shot('dashboard-1101');
  });
  await test('Selected patient continuity through real journey and billing links', async () => {
    await page.setViewportSize({width:1440,height:900});
    await page.goto(`${base}/patients`); await settled();
    const row=page.locator('.patient-layout .table-row').first();
    await row.click();
    await page.waitForURL(url => Boolean(url.searchParams.get('patientId')));
    await settled();
    const id=new URL(page.url()).searchParams.get('patientId'); assert.ok(id,'Patient selection must update URL');
    await shot('desktop-patient-selected');
    for (const route of ['journey','billing','schedule']) {
      const href=await page.locator(`.patient-quick-actions a[href^="/${route}?"]`).getAttribute('href');
      assert.equal(new URL(href,base).searchParams.get('patientId'),id);
    }
    await page.locator('.patient-quick-actions a[href^="/journey?"]').click();
    await page.waitForURL(url => url.pathname === '/journey' && url.searchParams.get('patientId') === id);
    await page.locator('.patient-chart').waitFor({state:'visible'});
    await settled();
    assert.equal(await page.locator('h1').innerText(),'One record, the whole journey');
    assert.equal(await page.locator('.workspace-desktop-navigation [aria-current=page]').getAttribute('href'),'/journey');
    assert.equal(new URL(page.url()).searchParams.get('patientId'),id);
    await shot('desktop-journey-selected');
    await writeFile(`${output}/odontogram-dom.html`, await page.locator('.patient-odontogram-editor').evaluate(node => node.outerHTML));
    await page.goto(`${base}/billing?patientId=${encodeURIComponent(id)}`);
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      await shot(width === 1440 ? 'desktop-billing-selected' : 'mobile-billing-selected');
      const fields = await page.locator('.billing-balance-form input:not([type=hidden]), .billing-balance-form select').evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return {width:rect.width,height:rect.height};
      }));
      assert.equal(fields.length,3,'The receipt form must retain amount, method and reference fields');
      for (const field of fields) assert.ok(field.height >= 44 && field.width >= 100, `Receipt field is too small at ${width}px`);
    }
    await page.goto(`${base}/patients?patientId=${encodeURIComponent(id)}`); await shot('mobile-patient-selected');
    await page.goto(`${base}/journey?patientId=${encodeURIComponent(id)}`); await shot('mobile-journey-selected');
  });
  await test('Remaining route surfaces remain usable with the new shell', async () => {
    for (const width of [1440,390]) {
      await page.setViewportSize({width,height:900});
      for (const route of ['community','patient-app','clinical','treatment']) {
        const response=await page.goto(`${base}/${route}`); assert.equal(response.status(),200);
        await shot(`${width}-${route}`);
        assert.equal(await page.locator('.story-topbar').count(),1);
      }
    }
  });
  await test('Runtime has no unhandled page errors', async () => assert.deepEqual(errors,[]));
} catch(error) {
  console.error(error); process.exitCode=1;
} finally {
  await writeFile(`${output}/results.json`,JSON.stringify({commit:process.env.GITHUB_SHA,results,errors},null,2));
  await context.close(); await browser.close();
  console.log(JSON.stringify({output,results},null,2));
}

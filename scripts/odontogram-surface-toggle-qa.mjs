import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BROWSER_QA_BASE_URL ?? 'http://127.0.0.1:3000';
const output = 'output/workspace-qa/surface-toggle';
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const results = [];
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 },
      hasTouch: width < 700, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/odontogram`, { waitUntil: 'networkidle' });
    const chart = page.getByRole('region', { name: 'Sơ đồ răng', exact: true });
    const surface = chart.locator('path[role=button][aria-label^="Răng 16, mặt"]');
    await surface.first().waitFor();
    assert.equal(await surface.count(), 5);
    const activate = node => width < 700 ? node.tap() : node.click();
    for (const node of await surface.all()) {
      await node.scrollIntoViewIfNeeded();
      const empty = await node.getAttribute('fill');
      assert.equal(empty, '#ffffff');
      await activate(node);
      assert.notEqual(await node.getAttribute('fill'), empty, 'First activation marks the face');
      await activate(node);
      assert.equal(await node.getAttribute('fill'), empty, 'Second activation clears the same face');
    }
    // Both views edit the same face. Neighbouring faces must survive a toggle.
    await activate(surface.nth(0));
    await activate(surface.nth(1));
    const selected = await surface.nth(0).getAttribute('fill');
    await activate(surface.nth(0));
    assert.equal(await surface.nth(1).getAttribute('fill'), selected);
    const detail = page.locator('aside path[role=button][aria-label^="Răng 16, mặt"]');
    assert.equal(await detail.count(), 5);
    const label = (await surface.nth(1).getAttribute('aria-label')).split(',').slice(0, 2).join(',');
    const sameFace = page.locator(`aside path[role=button][aria-label^="${label}"]`);
    await activate(sameFace);
    assert.equal(await surface.nth(1).getAttribute('fill'), '#ffffff');
    await surface.nth(0).focus();
    await surface.nth(0).press('Enter');
    await surface.nth(0).press('Enter');
    assert.equal(await surface.nth(0).getAttribute('fill'), '#ffffff');
    await surface.nth(0).press('Space');
    await surface.nth(0).press('Space');
    assert.equal(await surface.nth(0).getAttribute('fill'), '#ffffff');
    await surface.nth(0).press('Enter');
    await page.getByRole('button', { name: /^(Mối hàn|Hàn)$/ }).click();
    await surface.nth(0).press('Enter');
    const replacement = await surface.nth(0).getAttribute('fill');
    assert.notEqual(replacement, selected, 'A different condition replaces the current one');
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await surface.nth(0).getAttribute('fill'), replacement, 'The marking survives reload');
    await page.getByRole('button', { name: /^(Mối hàn|Hàn)$/ }).click();
    await activate(surface.nth(0));
    assert.equal(await surface.nth(0).getAttribute('fill'), '#ffffff');
    await page.getByRole('button', { name: 'Hoàn tác', exact: true }).click();
    assert.equal(await surface.nth(0).getAttribute('fill'), replacement, 'Undo restores the cleared face');
    await activate(surface.nth(0));
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await surface.nth(0).getAttribute('fill'), '#ffffff', 'Clearing survives reload');
    await page.evaluate(() => document.fonts.ready);
    await chart.screenshot({ path: `${output}/cleared-${width}.png` });
    results.push({ width, passed: true, mouseOrTouch: true, keyboard: true, persistence: true, undo: true });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS surface click/tap toggle, keyboard, condition replacement, shared detail state, undo and reload at 1440/390/320px');
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ results, errors }, null, 2));
  await browser.close();
}

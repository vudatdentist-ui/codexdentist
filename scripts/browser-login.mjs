import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

// The server-rendered form can be replaced during hydration. Fill only after
// the initial document, scripts and fonts have settled, and verify both fields.
export async function loginForBrowserAudit(page, { baseUrl, email, password, evidencePath }) {
  try {
    const response = await page.goto(`${baseUrl}/login`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, 'The login page must load successfully');
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const form = page.locator('form.login-form').first();
    const emailInput = form.locator('input[name=email]');
    const passwordInput = form.locator('input[name=password]');
    await emailInput.fill('');
    await emailInput.pressSequentially(email);
    await passwordInput.fill(password);
    assert.equal(await emailInput.inputValue(), email, 'Email must survive hydration');
    assert.ok(await passwordInput.inputValue() === password, 'Password must survive hydration');
    await Promise.all([
      page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 15000 }),
      form.locator('button[type=submit]').click(),
    ]);
    await page.waitForLoadState('networkidle');
  } catch (error) {
    await mkdir(dirname(evidencePath), { recursive: true });
    await page.screenshot({ path: `${evidencePath}.png`, fullPage: true }).catch(() => {});
    const state = await page.locator('form.login-form').first().evaluate(form => ({
      fields: [...form.querySelectorAll('input')].map(input => ({
        name: input.name, populated: Boolean(input.value), valid: input.validity.valid,
        validationMessage: input.validationMessage,
      })),
    })).catch(() => null);
    await writeFile(`${evidencePath}.json`, JSON.stringify({ url: page.url(), state, error: String(error) }, null, 2));
    throw error;
  }
}

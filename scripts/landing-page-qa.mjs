import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.LANDING_QA_BASE_URL ?? "http://127.0.0.1:3000");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Landing QA must target a disposable loopback server, not production.");
}
const output = path.resolve("output/landing-qa");
await mkdir(output, { recursive: true });
const results = [];
const publicTargets = new Set(["/signup", "/docs", "/features", "/login"]);
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
    ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
    : {}),
});
const profiles = [
  ["small-phone", 320, 740], ["phone", 360, 800], ["mobile", 390, 844],
  ["tablet", 768, 1024], ["landscape", 844, 390],
  ["laptop", 1024, 768], ["desktop", 1440, 1000], ["wide", 1920, 1080],
];
const failures = [];
try {
  for (const [name, width, height] of profiles) {
    const context = await browser.newContext({
      viewport: { width, height }, serviceWorkers: "block",
      hasTouch: width < 951, reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors = [];
    const layoutFindings = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => {
      if (response.url().startsWith(base.origin) && response.status() >= 400) {
        errors.push(`${response.status()} ${response.url()}`);
      }
    });
    try {
      const response = await page.goto(base.href, { waitUntil: "networkidle" });
      assert.equal(response.status(), 200);
      await page.locator('[data-landing-page="true"]').waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator("h1 em").evaluate(el => getComputedStyle(el).fontStyle), "normal", "Vietnamese display emphasis must not use the broken serif italic face");
      assert.match(await page.title(), /Codexdentist/);
      for (const href of await page.locator('[data-landing-page] a[href^="/"]').evaluateAll(links => links.map(a => a.getAttribute("href")))) publicTargets.add(href);
      layoutFindings.push(...await inspectLayout(page));
      await screenshot(page, `${name}-full`, true);
      await screenshot(page, `${name}-hero`);
      if (name === "laptop") {
        await page.setViewportSize({ width: 951, height });
        layoutFindings.push(...await inspectLayout(page));
        assert.equal(await page.locator("header").getByRole("link", { name: "Đăng nhập", exact: true }).isVisible(), true);
        await screenshot(page, "navigation-breakpoint");
        await page.setViewportSize({ width, height });
      }

      const tabs = page.getByRole("tab");
      assert.equal(await tabs.count(), 3);
      const headings = ["S\u1eb5n s\u00e0ng cho ng\u00e0y m\u1edbi.", "M\u1ed9t h\u1ed3 s\u01a1. C\u1ea3 h\u00e0nh tr\u00ecnh.", "Kh\u00e9p l\u1ea1i m\u1ed9t bu\u1ed5i kh\u00e1m."];
      for (let index = 0; index < 3; index++) {
        if (width < 951) await tabs.nth(index).tap();
        else await tabs.nth(index).click();
        await page.getByRole("tabpanel").getByRole("heading", { name: headings[index], exact: true }).waitFor();
        assert.equal(await tabs.nth(index).getAttribute("aria-selected"), "true");
        assert.equal(await page.getByRole("tabpanel").getAttribute("aria-labelledby"), `day-tab-${index}`);
        assert.equal(await page.locator('[role="tab"][tabindex="0"]').count(), 1);
        layoutFindings.push(...await inspectLayout(page));
        if (["mobile", "desktop"].includes(name)) {
          const preview = page.getByRole("tablist").locator("..");
          await preview.evaluate(el => el.scrollIntoView({ block: "center", behavior: "instant" }));
          const top = await preview.evaluate(el => el.getBoundingClientRect().top);
          assert.ok(top >= await page.locator("header").evaluate(el => el.getBoundingClientRect().bottom), "Preview evidence must not be obscured by the sticky header");
          await preview.screenshot({ path: path.join(output, `${name}-chapter-${index + 1}.png`) });
        }
      }
      // Native keyboard navigation, including wrapping and focus, must work without a mouse.
      for (const [key, index] of [["Home", 0], ["ArrowLeft", 2], ["ArrowRight", 0], ["End", 2]]) {
        await page.keyboard.press(key);
        await page.waitForFunction(i => document.activeElement?.id === `day-tab-${i}` && document.activeElement.getAttribute("aria-selected") === "true", index);
      }
      await tabs.nth(0).click();

      await page.evaluate(() => window.scrollTo(0, 0));
      if (width < 951) {
        const menu = page.locator("header details");
        await menu.locator("summary").click();
        assert.equal(await menu.getAttribute("open"), "");
        layoutFindings.push(...await inspectLayout(page));
        const login = menu.locator('a[href="/login"]');
        await login.scrollIntoViewIfNeeded();
        assert.ok((await login.boundingBox()).y + (await login.boundingBox()).height <= height + 1, "Menu must let landscape users reach login");
        if (["mobile", "landscape"].includes(name)) await screenshot(page, `${name}-menu`);
        await page.keyboard.press("Escape");
        assert.equal(await menu.getAttribute("open"), null);
        assert.equal(await menu.locator("summary").evaluate(el => el === document.activeElement), true);
        await menu.locator("summary").click();
        await menu.locator('a[href="#mot-ngay"]').click();
        await page.waitForFunction(() => location.hash === "#mot-ngay");
        assert.equal(await menu.getAttribute("open"), null);
      } else {
        assert.equal(await page.locator("header").getByRole("link", { name: "Đăng nhập", exact: true }).isVisible(), true);
        await page.getByRole("navigation", { name: "Điều hướng chính", exact: true }).getByRole("link", { name: "Cách vận hành", exact: true }).click();
      }
      const anchorTop = await page.locator("#mot-ngay").evaluate(el => el.getBoundingClientRect().top);
      const headerBottom = await page.locator("header").evaluate(el => el.getBoundingClientRect().bottom);
      assert.ok(anchorTop >= headerBottom - 2, "Sticky navigation must not cover the chapter heading");

      const faq = page.locator('details[name="landing-faq"]');
      assert.equal(await faq.count(), 4);
      for (let index = 0; index < 4; index++) {
        await faq.nth(index).locator("summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await faq.nth(index).getAttribute("open"), "");
        assert.equal(await page.locator('details[name="landing-faq"][open]').count(), 1);
        assert.equal(await faq.nth(index).locator("p").isVisible(), true);
        layoutFindings.push(...await inspectLayout(page));
      }
      if (name === "mobile") await page.locator("#cau-hoi").screenshot({ path: path.join(output, "mobile-faq.png") });
      await page.keyboard.press("Enter");
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.ok(await page.locator('a[href="/signup"]').count() >= 3, "Hosted trial CTAs must remain available");
      const marketingText = await page.locator('[data-landing-page="true"]').innerText();
      assert.doesNotMatch(marketingText, /mã nguồn mở|tự triển khai|dùng thử 24 giờ/i, "Hosted landing must not retain open-source or 24-hour demo positioning");
      const brokenAnchors = await page.locator('[data-landing-page] a[href^="#"]').evaluateAll(links => links.map(a => a.getAttribute("href")).filter(href => !document.getElementById(href.slice(1))));
      assert.deepEqual(brokenAnchors, []);
      assert.deepEqual(errors, [], "No browser exceptions or failed same-origin resources");
      assert.deepEqual([...new Set(layoutFindings)], [], "All responsive states must remain readable");
      results.push({ name, viewport: { width, height }, status: "pass", checks: ["layout", "contrast", "images", "tabs", "keyboard", "navigation", "faq", "links", "console"] });
    } catch (error) {
      await screenshot(page, `${name}-failure`, true).catch(() => {});
      failures.push(`${name}: ${error.message}`);
      results.push({ name, status: "fail", error: error.message, browserErrors: errors });
    } finally { await context.close(); }
  }

  // Progressive enhancement: public content, CTAs and native disclosures survive disabled JS.
  const plain = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    const page = await plain.newPage();
    await page.goto(base.href, { waitUntil: "load" });
    assert.equal(await page.locator("h1").isVisible(), true);
    await page.locator("header details summary").click();
    assert.equal(await page.locator('header details a[href="/signup"]').isVisible(), true);
    await page.locator("header details summary").click();
    await page.locator('details[name="landing-faq"]').first().locator("summary").click();
    assert.equal(await page.locator('details[name="landing-faq"]').first().locator("p").isVisible(), true);
    await screenshot(page, "no-javascript", true);
    results.push({ name: "no-javascript", status: "pass" });
  } catch (error) { failures.push(`no-javascript: ${error.message}`); }
  finally { await plain.close(); }

  // Public marketing endpoints are read-only here. Trial creation has a separate browser smoke.
  for (const endpoint of publicTargets) {
    const response = await browser.newPage();
    try {
      const target = new URL(endpoint, base);
      assert.equal(target.origin, base.origin);
      const result = await response.request.get(target.href);
      assert.equal(result.status(), 200, endpoint);
      // A successful docs response alone cannot prove that a linked section exists.
      if (target.hash) assert.ok((await result.text()).includes(`id="${decodeURIComponent(target.hash.slice(1))}"`), `Missing section: ${endpoint}`);
      results.push({ name: `GET ${endpoint}`, status: "pass" });
    } catch (error) { failures.push(error.message); }
    finally { await response.close(); }
  }
} finally {
  await browser.close();
  const report = { commit: process.env.GITHUB_SHA ?? "local-working-tree", capturedAt: new Date().toISOString(), base: base.origin, results, failures };
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
assert.deepEqual(failures, [], "Landing verification must pass on every supported profile");

async function screenshot(page, name, fullPage = false) {
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage, animations: "disabled" });
}

async function inspectLayout(page) {
  const findings = await page.evaluate(() => {
    const root = document.querySelector("[data-landing-page]");
    const faults = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) faults.push("Document overflows horizontally");
    for (const img of root.querySelectorAll("img")) {
      if (!img.complete || !img.naturalWidth) faults.push(`Broken image: ${img.getAttribute("src")}`);
    }
    const rgb = value => (value.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = values => values.slice(0, 3).map(v => {
      v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    for (const el of root.querySelectorAll("*")) {
      if (!el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true })) continue;
      const bounds = el.getBoundingClientRect();
      if (bounds.width && (bounds.right > innerWidth + 1 || bounds.left < -1) && !el.matches('a[href="#noi-dung"]')) faults.push(`Out of bounds: ${el.tagName} ${el.textContent.slice(0, 45)}`);
      const text = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join("");
      if (!text) continue;
      const style = getComputedStyle(el);
      let parent = el, background;
      while (parent) {
        const values = rgb(getComputedStyle(parent).backgroundColor);
        if (values.length === 3 || values[3] === 1) { background = values; break; }
        parent = parent.parentElement;
      }
      if (!background) continue;
      const fg = luminance(rgb(style.color)), bg = luminance(background);
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && parseInt(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) faults.push(`Text contrast ${ratio.toFixed(2)}: ${text.slice(0, 60)}`);
    }
    return [...new Set(faults)];
  });
  return findings;
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BROWSER_QA_BASE_URL ?? "http://127.0.0.1:3000";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join("output", "playwright", "public-landing-qa", runId);
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const networkErrors = [];

    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !response.url().includes("/favicon")) {
        networkErrors.push(`${response.status()} ${response.url()}`);
      }
    });

    const result = await auditLanding(page, viewport, consoleErrors, networkErrors);
    results.push(result);
    await context.close();
  }
} finally {
  await browser.close();
}

const failures = results.flatMap((result) =>
  result.failures.map((failure) => `${result.viewport}: ${failure}`),
);

await writeFile(
  path.join(outputDir, "summary.json"),
  JSON.stringify({ baseUrl, failures, results }, null, 2),
  "utf8",
);
await writeFile(
  path.join(outputDir, "REPORT.md"),
  renderMarkdown(results, failures),
  "utf8",
);

console.log(JSON.stringify({ outputDir, failures, results }, null, 2));

if (failures.length > 0) process.exitCode = 1;

async function auditLanding(page, viewport, consoleErrors, networkErrors) {
  const failures = [];
  let status = null;
  let navigationError = null;

  try {
    const response = await page.goto(`${baseUrl}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    status = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
    failures.push(`homepage navigation failed: ${navigationError}`);
  }

  if (status !== 200) failures.push(`homepage returned HTTP ${status ?? "unknown"}`);

  const hero = page.locator('[data-qa="landing-hero-title"]');
  if (!(await hero.isVisible().catch(() => false))) {
    failures.push("proposition-led H1 is not visible");
  } else {
    const heroText = (await hero.innerText()).trim();
    if (!/hệ điều hành/i.test(heroText) || /^Dental OS$/i.test(heroText)) {
      failures.push(`H1 is not proposition-led: ${heroText}`);
    }
  }

  const screenshot = page.locator('[data-qa="landing-hero-screenshot"]');
  if (!(await screenshot.isVisible().catch(() => false))) {
    failures.push("real hero product screenshot is not visible");
  } else {
    const screenshotState = await screenshot.evaluate((image) => ({
      complete: image.complete,
      naturalWidth: image.naturalWidth,
      src: image.getAttribute("src") ?? "",
      width: image.getBoundingClientRect().width,
    }));
    if (!screenshotState.complete || screenshotState.naturalWidth <= 0 || screenshotState.width <= 0) {
      failures.push("hero product screenshot did not render");
    }
    if (!screenshotState.src.includes("feature-schedule.png")) {
      failures.push(`unexpected hero screenshot source: ${screenshotState.src}`);
    }
  }

  await checkLink(page, '[data-qa="demo-cta"]', "demo CTA", failures, (url) =>
    url.pathname === "/demo" || url.hostname.startsWith("demo."),
  );
  await checkLink(page, '[data-qa="source-cta"]', "GitHub/source CTA", failures, (url) =>
    url.hostname === "github.com" || (url.pathname === "/docs" && url.hash === "#source"),
  );
  await checkLink(page, '[data-qa="docs-cta"]', "docs CTA", failures, (url) =>
    url.pathname === "/docs",
  );

  if (viewport.name === "mobile") {
    const menu = page.locator('[data-qa="mobile-menu"]');
    const summary = menu.locator("summary");
    if (!(await summary.isVisible().catch(() => false))) {
      failures.push("mobile navigation trigger is not visible");
    } else {
      await summary.focus();
      await page.keyboard.press("Enter");
      if (!(await menu.evaluate((element) => element.hasAttribute("open")))) {
        failures.push("mobile navigation does not open from keyboard");
      } else {
        await page.keyboard.press("Tab");
        const focusMovedIntoMenu = await menu.evaluate(
          (element) => element.contains(document.activeElement) && document.activeElement?.tagName === "A",
        );
        if (!focusMovedIntoMenu) {
          failures.push("Tab does not move focus into mobile navigation links");
        }
      }
      await summary.focus();
      await page.keyboard.press("Enter");
      if (await menu.evaluate((element) => element.hasAttribute("open"))) {
        failures.push("mobile navigation does not close from keyboard");
      }
    }
  }

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 ||
    document.body.scrollWidth > document.body.clientWidth + 2,
  );
  if (overflow) failures.push("homepage has horizontal overflow");

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.evaluate(() => {
    const target = document.querySelector('[data-qa="demo-cta"]');
    const transitionDuration = target ? getComputedStyle(target).transitionDuration : null;
    return {
      matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
      transitionDuration,
    };
  });
  if (!reducedMotion.matches) failures.push("prefers-reduced-motion emulation did not apply");
  if (reducedMotion.transitionDuration && reducedMotion.transitionDuration !== "0s") {
    failures.push(`reduced-motion keeps a transition: ${reducedMotion.transitionDuration}`);
  }

  const screenshotPath = path.join(outputDir, `${viewport.name}-homepage.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  if (consoleErrors.length > 0) {
    failures.push(`console errors: ${consoleErrors.slice(0, 2).join(" | ")}`);
  }
  if (networkErrors.length > 0) {
    failures.push(`network errors: ${networkErrors.slice(0, 2).join(" | ")}`);
  }

  return {
    viewport: viewport.name,
    dimensions: `${viewport.width}x${viewport.height}`,
    status,
    navigationError,
    screenshot: screenshotPath,
    reducedMotion,
    failures,
  };
}

async function checkLink(page, selector, label, failures, predicate) {
  const link = page.locator(`${selector}:visible`).first();
  if ((await link.count()) === 0) {
    failures.push(`${label} is not visible`);
    return;
  }

  const href = await link.getAttribute("href");
  if (!href) {
    failures.push(`${label} has no href`);
    return;
  }

  const url = new URL(href, baseUrl);
  if (!predicate(url)) failures.push(`${label} points to unexpected URL: ${url.href}`);
}

function renderMarkdown(results, failures) {
  return [
    "# Public Landing Browser QA",
    "",
    `Base URL: ${baseUrl}`,
    `Result: ${failures.length === 0 ? "PASS" : "FAIL"}`,
    "",
    "| Viewport | HTTP | Reduced motion | Failures | Screenshot |",
    "| --- | ---: | --- | --- | --- |",
    ...results.map((result) =>
      `| ${result.viewport} (${result.dimensions}) | ${result.status ?? "?"} | ${result.reducedMotion.matches ? "yes" : "no"} | ${result.failures.join("; ") || "none"} | ${result.screenshot} |`,
    ),
    "",
  ].join("\n");
}

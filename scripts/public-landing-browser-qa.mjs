import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.BROWSER_QA_BASE_URL ?? "http://127.0.0.1:3000";
const appRootDomain = process.env.APP_ROOT_DOMAIN?.trim().toLowerCase() || "codexdentist.com";
const configuredSourceUrl = process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL?.trim() || null;
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join("output", "playwright", "public-landing-v2-qa", runId);

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  results.push(await auditDesktop(browser));
  results.push(await auditMobile(browser));
} finally {
  await browser.close();
}

const routing = await auditPublicRouting();
const failures = [
  ...results.flatMap((result) => result.failures.map((failure) => `${result.viewport}: ${failure}`)),
  ...routing.failures.map((failure) => `routing: ${failure}`),
];

await writeFile(
  path.join(outputDir, "summary.json"),
  JSON.stringify({ baseUrl, failures, results, routing }, null, 2),
  "utf8",
);
await writeFile(
  path.join(outputDir, "REPORT.md"),
  renderMarkdown(results, routing, failures),
  "utf8",
);

console.log(JSON.stringify({ outputDir, failures, results, routing }, null, 2));
if (failures.length > 0) process.exitCode = 1;

async function loadLanding(browser, viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
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
  }

  return { context, page, consoleErrors, networkErrors, status, navigationError };
}

async function auditDesktop(browser) {
  const failures = [];
  const viewport = { width: 1440, height: 900 };
  const session = await loadLanding(browser, viewport);
  const { context, page, consoleErrors, networkErrors, status, navigationError } = session;

  try {
    if (navigationError) failures.push(`homepage navigation failed: ${navigationError}`);
    if (status !== 200) failures.push(`homepage returned HTTP ${status ?? "unknown"}`);

    await checkFoundation(page, viewport, failures);

    const firstViewport = path.join(outputDir, "desktop-1440x900-first-viewport.png");
    await page.screenshot({ path: firstViewport, fullPage: false });

    await activatePrompt(page, "patient", failures);
    await checkScene(page, "patient", "feature-patients.png", failures);
    const answered = path.join(outputDir, "desktop-1440x900-assistant-patient.png");
    await page.screenshot({ path: answered, fullPage: false });

    const input = page.locator('[data-qa="assistant-input"]');
    await input.fill("What should reception see this morning?");
    await input.press("Enter");
    await page.waitForFunction(
      () => document.querySelector('[data-qa="product-stage"]')?.getAttribute("data-scene") === "schedule",
    );
    await checkScene(page, "schedule", "feature-schedule.png", failures);

    await activatePrompt(page, "operations", failures);
    await checkScene(page, "operations", "feature-inventory.png", failures);
    const otherState = path.join(outputDir, "desktop-1440x900-stage-operations.png");
    await page.screenshot({ path: otherState, fullPage: false });

    await checkLinks(page, failures);
    await checkOverflow(page, failures);
    await checkReducedMotion(page, failures);

    await page.evaluate(() => window.scrollTo(0, 0));
    const fullPage = path.join(outputDir, "desktop-1440x900-full.png");
    await page.screenshot({ path: fullPage, fullPage: true });

    appendBrowserErrors(consoleErrors, networkErrors, failures);

    return {
      viewport: "desktop",
      dimensions: "1440x900",
      status,
      screenshots: { firstViewport, answered, otherState, fullPage },
      failures,
    };
  } finally {
    await context.close();
  }
}

async function auditMobile(browser) {
  const failures = [];
  const viewport = { width: 390, height: 844 };
  const session = await loadLanding(browser, viewport);
  const { context, page, consoleErrors, networkErrors, status, navigationError } = session;

  try {
    if (navigationError) failures.push(`homepage navigation failed: ${navigationError}`);
    if (status !== 200) failures.push(`homepage returned HTTP ${status ?? "unknown"}`);

    await checkFoundation(page, viewport, failures);
    await checkMobileProductCrop(page, failures);

    const firstViewport = path.join(outputDir, "mobile-390x844-first-viewport.png");
    await page.screenshot({ path: firstViewport, fullPage: false });

    const input = page.locator('[data-qa="assistant-input"]');
    const submit = page.locator('[data-qa="assistant-submit"]');
    await input.focus();
    const formFocusRing = await page.locator('form').filter({ has: input }).evaluate((form) => {
      const style = getComputedStyle(form);
      return style.boxShadow !== "none" && style.boxShadow !== "";
    });
    if (!formFocusRing) failures.push("assistant input focus is not visibly indicated");

    await page.keyboard.press("Tab");
    if (!(await submit.evaluate((element) => element === document.activeElement))) {
      failures.push("Tab does not move from assistant input to submit button");
    }
    await page.keyboard.press("Shift+Tab");
    if (!(await input.evaluate((element) => element === document.activeElement))) {
      failures.push("Shift+Tab does not return to assistant input");
    }

    await input.fill("Show me a patient.");
    await input.press("Enter");
    await page.waitForFunction(
      () => document.querySelector('[data-qa="product-stage"]')?.getAttribute("data-scene") === "patient",
    );
    await checkScene(page, "patient", "feature-patients.png", failures);

    const interaction = path.join(outputDir, "mobile-390x844-assistant-patient.png");
    await page.screenshot({ path: interaction, fullPage: false });

    await activatePrompt(page, "operations", failures);
    await checkScene(page, "operations", "feature-inventory.png", failures);

    await checkLinks(page, failures);
    await checkOverflow(page, failures);
    await checkReducedMotion(page, failures);

    await page.evaluate(() => window.scrollTo(0, 0));
    const fullPage = path.join(outputDir, "mobile-390x844-full.png");
    await page.screenshot({ path: fullPage, fullPage: true });

    appendBrowserErrors(consoleErrors, networkErrors, failures);

    return {
      viewport: "mobile",
      dimensions: "390x844",
      status,
      screenshots: { firstViewport, interaction, fullPage },
      failures,
    };
  } finally {
    await context.close();
  }
}

async function checkFoundation(page, viewport, failures) {
  const wordmark = page.locator('[data-qa="landing-wordmark"]');
  if (!(await wordmark.isVisible().catch(() => false))) {
    failures.push("Dental OS wordmark is not visible");
  } else if ((await wordmark.innerText()).trim() !== "Dental OS") {
    failures.push(`unexpected public wordmark: ${(await wordmark.innerText()).trim()}`);
  }

  const title = page.locator('[data-qa="landing-hero-title"]');
  if (!(await title.isVisible().catch(() => false))) {
    failures.push("hero headline is not visible");
  } else if ((await title.innerText()).trim() !== "Make your clinic day easier.") {
    failures.push(`unexpected hero headline: ${(await title.innerText()).trim()}`);
  }

  const assistant = page.locator('[data-qa="product-assistant"]');
  if (!(await assistant.isVisible().catch(() => false))) {
    failures.push("Ask Dental OS product guide is not visible");
  }

  const stage = page.locator('[data-qa="product-stage"]');
  if (!(await stage.isVisible().catch(() => false))) {
    failures.push("ProductStage is not visible");
    return;
  }

  const box = await stage.boundingBox();
  if (!box || box.y >= viewport.height || box.y + box.height <= 0) {
    failures.push("product is not visible in the first viewport");
  }

  await checkScene(page, "today", "dashboard-preview.png", failures);
}

async function activatePrompt(page, scene, failures) {
  const prompt = page.locator(`[data-scene-prompt="${scene}"]`);
  if (!(await prompt.isVisible().catch(() => false))) {
    failures.push(`${scene} prompt is not visible`);
    return;
  }
  await prompt.click();
  await page.waitForFunction(
    (expected) => document.querySelector('[data-qa="product-stage"]')?.getAttribute("data-scene") === expected,
    scene,
  );
}

async function checkScene(page, scene, expectedImage, failures) {
  const stage = page.locator('[data-qa="product-stage"]');
  const activeScene = await stage.getAttribute("data-scene");
  if (activeScene !== scene) failures.push(`ProductStage scene is ${activeScene}, expected ${scene}`);

  const image = page.locator(`[data-qa="product-stage-image-${scene}"]`);
  const imageState = await image.evaluate((element) => ({
    active: element.getAttribute("data-active"),
    complete: element.complete,
    naturalWidth: element.naturalWidth,
    src: element.getAttribute("src") ?? "",
    width: element.getBoundingClientRect().width,
    opacity: getComputedStyle(element).opacity,
  }));

  if (imageState.active !== "true" || imageState.opacity === "0") {
    failures.push(`${scene} product image is not active`);
  }
  if (!imageState.complete || imageState.naturalWidth <= 0 || imageState.width <= 0) {
    failures.push(`${scene} product image did not render`);
  }
  if (!imageState.src.includes(expectedImage)) {
    failures.push(`${scene} uses unexpected product image: ${imageState.src}`);
  }

  const response = (await page.locator('[data-qa="assistant-response"]').innerText()).trim();
  if (!response) failures.push("assistant response is empty");
}

async function checkMobileProductCrop(page, failures) {
  const stage = page.locator('[data-qa="product-stage"]');
  const box = await stage.boundingBox();
  if (!box || box.width < 330 || box.height < 300) {
    failures.push(`mobile product crop is too small: ${box ? `${box.width}x${box.height}` : "missing"}`);
  }
}

async function checkLinks(page, failures) {
  await checkLink(page, '[data-qa="header-demo-cta"]', "live demo CTA", failures, (url) =>
    url.pathname === "/demo" || url.hostname.startsWith("demo."),
  );
  await checkLink(page, '[data-qa="header-source-cta"]', "GitHub CTA", failures, (url) => {
    if (configuredSourceUrl) return url.href === new URL(configuredSourceUrl, baseUrl).href;
    return url.pathname === "/docs" && url.hash === "#source";
  }, true);
  await checkLink(page, '[data-qa="docs-cta"]', "Docs CTA", failures, (url) => url.pathname === "/docs");
}

async function checkOverflow(page, failures) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 ||
    document.body.scrollWidth > document.body.clientWidth + 2,
  );
  if (overflow) failures.push("homepage has horizontal overflow");
}

async function checkReducedMotion(page, failures) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.scrollTo(0, 0));

  const before = await page.locator('[data-qa="product-stage-image-patient"]').evaluate((image) => ({
    transitionDuration: getComputedStyle(image).transitionDuration,
    animationName: getComputedStyle(image).animationName,
  }));

  if (!matchNoMaterialMotion(before.transitionDuration)) {
    failures.push(`reduced motion keeps screenshot transition: ${before.transitionDuration}`);
  }
  if (before.animationName !== "none") {
    failures.push(`reduced motion keeps screenshot animation: ${before.animationName}`);
  }

  await page.locator('[data-scene-prompt="patient"]').click();
  const immediateScene = await page.locator('[data-qa="product-stage"]').getAttribute("data-scene");
  if (immediateScene !== "patient") {
    failures.push("reduced-motion interaction does not switch ProductStage immediately");
  }

  const reducedMotionMatches = await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  if (!reducedMotionMatches) failures.push("prefers-reduced-motion emulation did not apply");
}

function matchNoMaterialMotion(value) {
  const durations = value.split(",").map((part) => part.trim());
  return durations.every((duration) => {
    if (duration.endsWith("ms")) return Number.parseFloat(duration) <= 1;
    if (duration.endsWith("s")) return Number.parseFloat(duration) <= 0.001;
    return duration === "0";
  });
}

async function checkLink(page, selector, label, failures, predicate, allowHidden = false) {
  const candidates = page.locator(selector);
  const count = await candidates.count();
  if (count === 0) {
    failures.push(`${label} is missing`);
    return;
  }

  let link = candidates.first();
  if (!allowHidden) {
    const visible = page.locator(`${selector}:visible`).first();
    if ((await visible.count()) === 0) {
      failures.push(`${label} is not visible`);
      return;
    }
    link = visible;
  }

  const href = await link.getAttribute("href");
  if (!href) {
    failures.push(`${label} has no href`);
    return;
  }

  const url = new URL(href, baseUrl);
  if (!predicate(url)) failures.push(`${label} points to unexpected URL: ${url.href}`);
}

function appendBrowserErrors(consoleErrors, networkErrors, failures) {
  if (consoleErrors.length > 0) failures.push(`console errors: ${consoleErrors.slice(0, 2).join(" | ")}`);
  if (networkErrors.length > 0) failures.push(`network errors: ${networkErrors.slice(0, 2).join(" | ")}`);
}

async function auditPublicRouting() {
  const failures = [];
  const cases = [
    { name: "docs routing", host: `docs.${appRootDomain}`, kind: "redirect", pathname: "/docs" },
    { name: "odontogram public route", host: `odontogram.${appRootDomain}`, kind: "ok" },
    { name: "demo routing", host: `demo.${appRootDomain}`, kind: "ok" },
    { name: "tenant redirect", host: `qa-clinic.${appRootDomain}`, kind: "redirect", pathname: "/dashboard" },
    { name: "app redirect", host: `app.${appRootDomain}`, kind: "redirect", pathname: "/dashboard" },
    { name: "admin redirect", host: `admin.${appRootDomain}`, kind: "redirect", pathname: "/dashboard" },
  ];
  const results = [];

  for (const testCase of cases) {
    try {
      const response = await fetch(`${baseUrl}/`, {
        headers: { "x-forwarded-host": testCase.host },
        redirect: "manual",
      });
      const location = response.headers.get("location");
      results.push({ name: testCase.name, host: testCase.host, status: response.status, location });

      if (testCase.kind === "ok") {
        if (response.status !== 200) failures.push(`${testCase.name} returned HTTP ${response.status}`);
        continue;
      }

      if (![301, 302, 303, 307, 308].includes(response.status)) {
        failures.push(`${testCase.name} did not redirect; HTTP ${response.status}`);
        continue;
      }

      const redirectedPath = location ? new URL(location, baseUrl).pathname : null;
      if (redirectedPath !== testCase.pathname) {
        failures.push(`${testCase.name} redirected to ${redirectedPath ?? "no location"}, expected ${testCase.pathname}`);
      }
    } catch (error) {
      failures.push(`${testCase.name} request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { appRootDomain, results, failures };
}

function renderMarkdown(results, routing, failures) {
  return [
    "# Public Landing V2 Browser QA",
    "",
    `Base URL: ${baseUrl}`,
    `Result: ${failures.length === 0 ? "PASS" : "FAIL"}`,
    "",
    "| Viewport | HTTP | Failures | Screenshots |",
    "| --- | ---: | --- | --- |",
    ...results.map((result) =>
      `| ${result.viewport} (${result.dimensions}) | ${result.status ?? "?"} | ${result.failures.join("; ") || "none"} | ${Object.values(result.screenshots).join(", ")} |`,
    ),
    "",
    `Routing host root: ${routing.appRootDomain}`,
    "",
    "| Routing check | Host | HTTP | Location |",
    "| --- | --- | ---: | --- |",
    ...routing.results.map((result) =>
      `| ${result.name} | ${result.host} | ${result.status} | ${result.location ?? "-"} |`,
    ),
    "",
  ].join("\n");
}

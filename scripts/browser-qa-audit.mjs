import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  enabledMigrationRoutes,
  materializePatientRoute,
  routeNeedsPatientId,
} from "./qa-route-contract.mjs";

const baseUrl = process.env.BROWSER_QA_BASE_URL ?? "http://127.0.0.1:3000";
const email = process.env.BROWSER_QA_EMAIL ?? "owner@nhavista.vn";
const password = process.env.BROWSER_QA_PASSWORD ?? "CodexSmoke2026!";
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = path.join("output", "playwright", "pilot-browser-qa", runId);
const legacyRoutes = [
  "/dashboard",
  "/schedule",
  "/patients",
  "/journey",
  "/billing",
  "/accounting",
  "/services",
  "/staff",
  "/crm",
  "/inventory",
  "/pharmacy",
  "/forms",
  "/learning",
  "/employee-app",
  "/reports",
  "/settings",
];
const migrationRoutes = enabledMigrationRoutes(
  process.env.BROWSER_QA_MIGRATION_ROUTES,
  "BROWSER_QA_MIGRATION_ROUTES",
);
const routes = [...new Set([...legacyRoutes, ...migrationRoutes])];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];
const technicalCopyPatterns = [
  /PostgreSQL/i,
  /database is connected/i,
  /demo mode/i,
  /Database live/i,
  /D[u\u1eef] li[e\u1ec7]u th[a\u1ead]t/i,
  /server console/i,
  /Internal Server Error/i,
  /Runtime Error/i,
  /This view could not be loaded/i,
];
const mojibakePattern = /(?:\u00c4[\u0080-\u00bf]|\u00c6[\u0080-\u00bf]|\u00e1[\u00ba-\u00bf]|\u00c2[\u00a0-\u00bf]|\ufffd)/u;
let discoveredPatientId = process.env.BROWSER_QA_PATIENT_ID ?? process.env.QA_PATIENT_ID ?? null;

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
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("response", (response) => {
      const status = response.status();
      const url = response.url();

      if (status >= 400 && !url.includes("/favicon")) {
        networkErrors.push(`${status} ${url}`);
      }
    });

    await login(page);

    if (migrationRoutes.length > 0) {
      console.log(`migration browser routes (${viewport.name}): ${migrationRoutes.join(", ")}`);
    }

    for (const route of routes) {
      const routeResult = await auditRoute(page, viewport, route, consoleErrors, networkErrors);
      results.push(routeResult);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const summary = summarize(results);
await writeFile(path.join(outputDir, "summary.json"), JSON.stringify({ summary, results }, null, 2), "utf8");
await writeFile(path.join(outputDir, "REPORT.md"), renderMarkdown(summary, results), "utf8");

console.log(JSON.stringify({ outputDir, summary }, null, 2));

if (summary.critical + summary.high > 0) {
  process.exitCode = 1;
}

async function login(page) {
  const response = await page.goto(`${baseUrl}/login`, {
    waitUntil: "domcontentloaded",
  });

  if (!response || response.status() >= 400) {
    throw new Error(`/login returned HTTP ${response?.status() ?? "unknown"}`);
  }

  const loginForm = page.locator("form.login-form").first();
  const emailInput = loginForm.locator('input[type="email"]').first();
  await emailInput.click();
  await emailInput.pressSequentially(email);
  await loginForm.locator('input[name="password"]').fill(password);
  await loginForm.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(1500);

  const currentPath = new URL(page.url()).pathname;
  if (currentPath.endsWith("/login")) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `Login failed for ${email}; still on ${page.url()}. ${bodyText.slice(0, 300)}`,
    );
  }
}

async function auditRoute(page, viewport, route, consoleErrors, networkErrors) {
  const beforeConsole = consoleErrors.length;
  const beforeNetwork = networkErrors.length;
  let resolvedRoute = route;
  let status = null;
  let navigationError = null;

  try {
    resolvedRoute = await resolveBrowserRoute(page, route);
    const response = await page.goto(`${baseUrl}${resolvedRoute}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    status = response?.status() ?? null;
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  } catch (error) {
    navigationError = error instanceof Error ? error.message : String(error);
  }

  await page.waitForTimeout(500);
  const screenshot = path.join(outputDir, `${viewport.name}-${routeName(route)}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });

  const pageCheck = await page.evaluate(
    ({ technicalSources, mojibakeSource }) => {
      const text = document.body?.innerText ?? "";
      const technicalPatterns = technicalSources.map((source) => new RegExp(source, "i"));
      const mojibake = new RegExp(mojibakeSource, "u");
      const overflow =
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 2;
      const bodyOverflow = document.body.scrollWidth > document.body.clientWidth + 2;
      const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog'))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        })
        .length;
      const routeError = /Workspace error|This view could not be loaded|Internal Server Error|Runtime Error/i.test(text);
      const mojibakeMatch = text.match(mojibake);

      return {
        title: document.title,
        textLength: text.length,
        routeError,
        horizontalOverflow: overflow || bodyOverflow,
        visibleDialogs,
        mojibake: Boolean(mojibakeMatch),
        mojibakeSnippet: mojibakeMatch
          ? text.slice(Math.max(0, mojibakeMatch.index - 40), mojibakeMatch.index + 80)
          : null,
        technicalCopy: technicalPatterns
          .filter((pattern) => pattern.test(text))
          .map((pattern) => pattern.source),
      };
    },
    {
      technicalSources: technicalCopyPatterns.map((pattern) => pattern.source),
      mojibakeSource: mojibakePattern.source,
    },
  );

  const routeConsoleErrors = consoleErrors.slice(beforeConsole);
  const routeNetworkErrors = networkErrors.slice(beforeNetwork);
  const severity = classify({
    status,
    navigationError,
    pageCheck,
    routeConsoleErrors,
    routeNetworkErrors,
  });

  return {
    route,
    resolvedRoute,
    viewport: viewport.name,
    status,
    severity,
    navigationError,
    screenshot,
    ...pageCheck,
    consoleErrors: routeConsoleErrors,
    networkErrors: routeNetworkErrors,
  };
}

async function resolveBrowserRoute(page, route) {
  if (!routeNeedsPatientId(route)) return route;

  if (!discoveredPatientId) {
    const response = await page.goto(`${baseUrl}/patients`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (!response || response.status() !== 200) {
      throw new Error(
        `Cannot discover patient id: /patients returned HTTP ${response?.status() ?? "unknown"}.`,
      );
    }
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);

    const hrefs = await page.locator('a[href^="/patients/"]').evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href")).filter(Boolean),
    );

    for (const href of hrefs) {
      const pathname = new URL(href, baseUrl).pathname;
      const patientMatch = pathname.match(/^\/patients\/([^/]+)$/);
      const candidate = patientMatch?.[1];
      if (candidate && !["new", "create"].includes(candidate.toLowerCase())) {
        discoveredPatientId = decodeURIComponent(candidate);
        break;
      }
    }
  }

  return materializePatientRoute(route, discoveredPatientId);
}

function classify(input) {
  if (input.navigationError || !input.status || input.status >= 500 || input.pageCheck.routeError) {
    return "Critical";
  }

  if (input.status >= 400 || input.pageCheck.mojibake) {
    return "High";
  }

  if (
    input.pageCheck.horizontalOverflow ||
    input.routeConsoleErrors.length > 0 ||
    input.routeNetworkErrors.some((item) => item.startsWith("5"))
  ) {
    return "Medium";
  }

  if (input.pageCheck.technicalCopy.length > 0 || input.routeNetworkErrors.length > 0) {
    return "Low";
  }

  return "Pass";
}

function summarize(items) {
  return {
    total: items.length,
    pass: items.filter((item) => item.severity === "Pass").length,
    low: items.filter((item) => item.severity === "Low").length,
    medium: items.filter((item) => item.severity === "Medium").length,
    high: items.filter((item) => item.severity === "High").length,
    critical: items.filter((item) => item.severity === "Critical").length,
  };
}

function renderMarkdown(summary, items) {
  const rows = items
    .filter((item) => item.severity !== "Pass")
    .map((item) => {
      const issue = [
        item.navigationError,
        item.status && item.status >= 400 ? `HTTP ${item.status}` : null,
        item.routeError ? "route error copy visible" : null,
        item.mojibake ? `mojibake visible: ${item.mojibakeSnippet}` : null,
        item.horizontalOverflow ? "horizontal overflow" : null,
        item.technicalCopy.length ? `technical copy: ${item.technicalCopy.join(", ")}` : null,
        item.consoleErrors.length ? `console: ${item.consoleErrors.slice(0, 2).join(" | ")}` : null,
        item.networkErrors.length ? `network: ${item.networkErrors.slice(0, 2).join(" | ")}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      const routeLabel = item.resolvedRoute !== item.route
        ? `${item.route} -> ${item.resolvedRoute}`
        : item.route;

      return `| ${item.severity} | ${item.viewport} | ${routeLabel} | ${issue} | ${item.screenshot} |`;
    })
    .join("\n");

  return [
    "# Pilot Browser QA",
    "",
    `Base URL: ${baseUrl}`,
    `Account: ${email}`,
    `Summary: ${JSON.stringify(summary)}`,
    "",
    "| Severity | Viewport | Route | Issue | Screenshot |",
    "| --- | --- | --- | --- | --- |",
    rows || "| Pass | all | all | No route-level issues detected. | - |",
    "",
  ].join("\n");
}

function routeName(route) {
  return route.replace(/^\//, "").replace(/[^a-z0-9_-]+/gi, "-") || "root";
}

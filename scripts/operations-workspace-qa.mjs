import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { loginForBrowserAudit } from "./browser-login.mjs";

const base = process.env.BROWSER_QA_BASE_URL ?? "http://127.0.0.1:3000";
if (process.env.NODE_ENV !== "test" || !process.env.DATABASE_URL ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname)) {
  throw new Error("Operations browser QA requires a disposable loopback app and database.");
}
const output = "output/workspace-qa/operations";
await mkdir(output, { recursive: true });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const faults = [];
const results = [];
const suffix = randomUUID().slice(0, 8);
page.on("pageerror", error => faults.push(error.message));
async function check(name, run) {
  try { await run(); results.push({ name, status: "passed" }); }
  catch (error) {
    results.push({ name, status: "failed", error: String(error) });
    await page.screenshot({ path: `${output}/failure-${results.length}.png`, fullPage: true }).catch(() => {});
  }
}
async function visit(route) {
  assert.equal((await page.goto(`${base}/${route}`, { waitUntil: "networkidle" })).status(), 200);
  await page.locator(".story-topbar").waitFor();
  await page.evaluate(() => document.fonts.ready);
}
async function choosePatient() {
  const select = page.locator('select[name="patientId"]');
  await select.locator("option").nth(1).waitFor({ state: "attached" });
  await select.selectOption(await select.locator("option").nth(1).getAttribute("value"));
}
async function capture(route) {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), `${route} overflow at ${width}px`);
    assert.equal(await page.locator('h1').count(), 1, "Shared shell supplies one page title");
    await page.screenshot({ path: `${output}/${route}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
try {
  await loginForBrowserAudit(page, { baseUrl: base, email: process.env.BROWSER_QA_EMAIL ?? "owner@nhavista.vn",
    password: process.env.BROWSER_QA_PASSWORD ?? "CodexSmoke2026!", evidencePath: `${output}/login` });
  await check("Lab case can be created, progressed, reloaded and audited through the operator UI", async () => {
    await visit("lab");
    await page.locator("summary").filter({ hasText: /^Tạo ca labo$/ }).click();
    await choosePatient();
    await page.getByLabel("Nội dung công việc", { exact: true }).fill(`Browser lab ${suffix}`);
    await page.getByLabel("Loại phục hình", { exact: true }).fill("Mão sứ răng 11");
    await page.getByLabel("Labo thực hiện", { exact: true }).fill("Synthetic test laboratory");
    await page.getByRole("button", { name: "Tạo ca labo", exact: true }).click();
    const card = page.locator("article").filter({ hasText: `Browser lab ${suffix}` });
    await card.waitFor();
    const row = await prisma.labCase.findFirstOrThrow({ where: { title: `Browser lab ${suffix}` } });
    assert.equal(row.status, "DRAFT");
    for (const [status, label] of [["SENT", "Đã gửi labo"], ["IN_PROGRESS", "Đang thực hiện"], ["READY", "Đã hoàn tất"], ["DELIVERED", "Đã nhận"]]) {
      await card.locator('select[name="status"]').selectOption(status);
      await card.getByRole("button", { name: "Cập nhật ca labo", exact: true }).click();
      await card.getByText(label, { exact: true }).waitFor();
    }
    const invalid = await context.request.post(`${base}/api/lab/cases/${row.id}/status`, {
      data: { status: "DRAFT" }, headers: { origin: base },
    });
    assert.equal(invalid.status(), 400, "Delivered cases cannot regress to draft");
    await page.reload({ waitUntil: "networkidle" });
    await card.getByText("Đã nhận", { exact: true }).waitFor();
    assert.equal((await prisma.labCase.findUniqueOrThrow({ where: { id: row.id } })).status, "DELIVERED");
    assert.equal(await prisma.auditLog.count({ where: { organizationId: row.organizationId, entityId: row.id } }), 5);
    await capture("lab");
  });
  await check("Sterilization instrument and cycle can be created, completed and released with traceability", async () => {
    await visit("sterilization");
    await page.locator("summary").filter({ hasText: /^Thêm dụng cụ$/ }).click();
    const code = `QA-${suffix}`;
    await page.getByLabel("Mã dụng cụ", { exact: true }).fill(code);
    await page.getByLabel("Tên dụng cụ", { exact: true }).fill("Bộ khám kiểm thử");
    await page.getByLabel("Nhóm dụng cụ", { exact: true }).fill("Bộ khám");
    await page.getByRole("button", { name: "Thêm dụng cụ", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Đã thêm dụng cụ." }).waitFor();
    await page.locator("summary").filter({ hasText: /^Tạo chu kỳ vô trùng$/ }).click();
    await page.getByLabel("Phương pháp", { exact: true }).fill(`Steam ${suffix}`);
    await page.getByLabel("Máy thực hiện", { exact: true }).fill("Synthetic autoclave");
    const checkbox = page.getByRole("checkbox", { name: `${code} · Bộ khám kiểm thử`, exact: true });
    await checkbox.waitFor();
    await checkbox.check();
    await page.getByRole("button", { name: "Tạo chu kỳ", exact: true }).click();
    const card = page.locator("article").filter({ hasText: `Steam ${suffix}` });
    await card.waitFor();
    const row = await prisma.sterilizationCycle.findFirstOrThrow({ where: { method: `Steam ${suffix}` }, include: { instruments: true } });
    assert.equal(row.instruments.length, 1);
    const instrument = await prisma.sterilizationInstrument.findUniqueOrThrow({ where: { id: row.instruments[0].instrumentId } });
    assert.equal(instrument.code, code);
    assert.equal(instrument.organizationId, row.organizationId);
    assert.equal(instrument.clinicId, row.clinicId);
    const invalid = await context.request.post(`${base}/api/sterilization/cycles/${row.id}/status`, {
      data: { status: "RELEASED" }, headers: { origin: base },
    });
    assert.equal(invalid.status(), 400, "A preparing cycle cannot be released");
    for (const [status, label] of [["RUNNING", "Đang chạy"], ["PASSED", "Đạt"], ["RELEASED", "Đã phát hành"]]) {
      await card.locator('select[name="status"]').selectOption(status);
      await card.getByRole("button", { name: "Cập nhật chu kỳ", exact: true }).click();
      await card.getByText(label, { exact: true }).waitFor();
    }
    await page.reload({ waitUntil: "networkidle" });
    await card.getByText("Đã phát hành", { exact: true }).waitFor();
    const released = await prisma.sterilizationCycle.findUniqueOrThrow({ where: { id: row.id } });
    assert.ok(released.startedAt && released.completedAt && released.releasedAt);
    assert.equal(await prisma.auditLog.count({ where: { organizationId: row.organizationId, entityId: row.id } }), 4);
    await capture("sterilization");
  });
  await check("Imaging remains usable and preserves form input while its optional PACS is unconfigured", async () => {
    await visit("imaging");
    await page.locator("summary").filter({ hasText: /^Liên kết phim chụp$/ }).click();
    await choosePatient();
    await page.getByLabel("Mã phim chụp", { exact: true }).fill(`missing-${suffix}`);
    await page.getByRole("button", { name: "Liên kết phim chụp", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByLabel("Mã phim chụp", { exact: true }).inputValue(), `missing-${suffix}`);
    assert.equal(await prisma.imagingStudy.count({ where: { externalStudyId: `missing-${suffix}` } }), 0);
    await capture("imaging-unavailable");
  });
  assert.deepEqual(faults, []);
} catch (error) {
  results.push({ name: "Operations audit setup or unhandled error", status: "failed", error: String(error) });
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify({ commit: process.env.GITHUB_SHA, results, faults }, null, 2));
  console.log(JSON.stringify({ output, results }, null, 2));
  await browser.close();
  await prisma.$disconnect();
  if (results.some(row => row.status === "failed")) process.exitCode = 1;
}

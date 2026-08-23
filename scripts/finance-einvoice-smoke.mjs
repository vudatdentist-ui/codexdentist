import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.FINANCE_EINVOICE_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.FINANCE_EINVOICE_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const organizationId = "org_nhavista";
const clinicId = "hcm-q1";
const invoiceId = "finance-einvoice-smoke-invoice";
const invoiceItemId = "finance-einvoice-smoke-item";
const paymentId = "finance-einvoice-smoke-payment";
const receiptId = "finance-einvoice-smoke-receipt";
const allocationId = "finance-einvoice-smoke-allocation";
const invoiceNo = "FIN-EINV-SMOKE";
const receiptNo = "FIN-EINV-RCPT";
const initialAmount = 1_000_000;
const amendedAmount = 1_200_000;
const firstExternalId = "EXT-SMOKE-001";
const replacementExternalId = "EXT-SMOKE-002";

async function main() {
  const fixture = await resetFixture();
  const browser = await chromium.launch({ headless: true });

  try {
    await assertFinanceRoleAccess(browser);
    await assertProviderFailureCreatesWork(browser);
    await assertManualIssuanceResolvesProviderFailure(browser);
    await assertAmountMismatchAndReplacement(browser);
    await assertVoidMismatchAndExternalCancellation(browser);
    await assertAuditTrail();
    console.log(`ok finance/e-invoice loop for ${fixture.patientName}`);
  } finally {
    await browser.close();
    await cleanupFixture();
  }

  console.log("ok finance and e-invoice operational smoke");
}

async function resetFixture() {
  await cleanupFixture();

  const treatmentService = await prisma.treatmentService.findFirst({
    where: {
      organizationId,
      clinicId,
      status: { not: "CANCELLED" },
    },
    include: {
      patient: { select: { id: true, fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (!treatmentService) {
    throw new Error("Finance/e-invoice smoke requires one seeded treatment service in hcm-q1.");
  }

  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await prisma.invoice.create({
    data: {
      id: invoiceId,
      organizationId,
      clinicId,
      patientId: treatmentService.patientId,
      invoiceNo,
      status: "PAID",
      amount: initialAmount,
      paidAmount: initialAmount,
      dueDate,
    },
  });

  await prisma.invoiceItem.create({
    data: {
      id: invoiceItemId,
      organizationId,
      clinicId,
      patientId: treatmentService.patientId,
      invoiceId,
      treatmentServiceId: treatmentService.id,
      description: "Finance/e-invoice smoke treatment item",
      quantity: 1,
      unitPrice: initialAmount,
      amount: initialAmount,
    },
  });

  await prisma.payment.create({
    data: {
      id: paymentId,
      invoiceId,
      amount: initialAmount,
      method: "CASH",
      reference: "FINANCE-EINVOICE-SMOKE",
      paidAt: new Date(),
    },
  });

  await prisma.receipt.create({
    data: {
      id: receiptId,
      organizationId,
      clinicId,
      patientId: treatmentService.patientId,
      receiptNo,
      amount: initialAmount,
      allocatedAmount: initialAmount,
      unallocatedAmount: 0,
      method: "CASH",
      reference: "FINANCE-EINVOICE-SMOKE",
      note: "Finance/e-invoice smoke fixture",
      receivedAt: new Date(),
    },
  });

  await prisma.receiptAllocation.create({
    data: {
      id: allocationId,
      organizationId,
      clinicId,
      patientId: treatmentService.patientId,
      receiptId,
      invoiceId,
      invoiceItemId,
      treatmentServiceId: treatmentService.id,
      amount: initialAmount,
      note: "Finance/e-invoice smoke allocation",
    },
  });

  return {
    patientId: treatmentService.patientId,
    patientName: treatmentService.patient.fullName,
    treatmentServiceId: treatmentService.id,
  };
}

async function cleanupFixture() {
  await prisma.auditLog.deleteMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: invoiceId,
      action: { startsWith: "einvoice." },
    },
  });
  await prisma.receiptAllocation.deleteMany({ where: { id: allocationId } });
  await prisma.payment.deleteMany({ where: { id: paymentId } });
  await prisma.invoiceItem.deleteMany({ where: { id: invoiceItemId } });
  await prisma.receipt.deleteMany({
    where: {
      organizationId,
      OR: [{ id: receiptId }, { receiptNo }],
    },
  });
  await prisma.invoice.deleteMany({
    where: {
      organizationId,
      OR: [{ id: invoiceId }, { invoiceNo }],
    },
  });
}

async function assertFinanceRoleAccess(browser) {
  await withLoggedInPage(browser, "billing@nhavista.vn", async (page) => {
    const response = await page.goto(`${baseUrl}/operations/finance`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    if (!response || response.status() >= 400 || new URL(page.url()).pathname !== "/operations/finance") {
      throw new Error(`Billing could not open Finance workspace: ${response?.status() ?? "unknown"} ${page.url()}`);
    }
    await expectText(page, "Hóa đơn & HĐĐT");
    await expectText(page, invoiceNo);
  });

  await withLoggedInPage(browser, "manager@nhavista.vn", async (page) => {
    await page.goto(`${baseUrl}/operations/finance`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    if (new URL(page.url()).pathname !== "/operations/finance") {
      throw new Error("Clinic manager unexpectedly denied Finance workspace.");
    }
  });

  await withLoggedInPage(browser, "frontdesk@nhavista.vn", async (page) => {
    await page.goto(`${baseUrl}/operations/finance`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    if (new URL(page.url()).pathname === "/operations/finance") {
      throw new Error("Front Desk unexpectedly received Finance operations workspace.");
    }
  });

  console.log("ok Finance workspace role boundaries");
}

async function assertProviderFailureCreatesWork(browser) {
  await withLoggedInPage(browser, "billing@nhavista.vn", async (page) => {
    await openFinance(page);
    const row = invoiceRow(page);
    await row.getByRole("button", { name: "Yêu cầu HĐĐT", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/operations/finance", { timeout: 15000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Lỗi");
    await expectText(page, "PROVIDER_NOT_CONFIGURED");

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, `HĐĐT lỗi: ${invoiceNo}`);
  });

  const actions = await invoiceAuditActions();
  assertSequence(actions, ["einvoice.pending", "einvoice.failed"]);
  console.log("ok unconfigured provider fails closed and creates Work signal");
}

async function assertManualIssuanceResolvesProviderFailure(browser) {
  await withLoggedInPage(browser, "billing@nhavista.vn", async (page) => {
    await openFinance(page);
    const row = invoiceRow(page);
    await row.locator("summary").filter({ hasText: "Đối soát" }).click();
    const form = row.locator('form:has(input[name="providerKey"])').first();
    await form.locator('input[name="externalInvoiceId"]').fill(firstExternalId);
    await form.locator('input[name="lookupCode"]').fill("LOOKUP-SMOKE-001");
    await form.locator('input[name="providerKey"]').fill("external-smoke");
    await form.getByRole("button", { name: "Xác nhận đã phát hành", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/operations/finance", { timeout: 15000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Đã phát hành");
    await expectText(page, firstExternalId);

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectAbsent(page, `HĐĐT lỗi: ${invoiceNo}`);
  });

  const actions = await invoiceAuditActions();
  assertSequence(actions, ["einvoice.pending", "einvoice.failed", "einvoice.issued"]);
  console.log("ok manual external issuance reconciles failed provider state");
}

async function assertAmountMismatchAndReplacement(browser) {
  await prisma.$transaction([
    prisma.invoice.update({
      where: { id: invoiceId },
      data: { amount: amendedAmount, status: "PARTIAL" },
    }),
    prisma.invoiceItem.update({
      where: { id: invoiceItemId },
      data: { unitPrice: amendedAmount, amount: amendedAmount },
    }),
  ]);

  await withLoggedInPage(browser, "billing@nhavista.vn", async (page) => {
    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, `Số tiền HĐĐT lệch hóa đơn: ${invoiceNo}`);

    await openFinance(page);
    const row = invoiceRow(page);
    await row.locator("summary").filter({ hasText: "Đối soát" }).click();
    const form = row.locator('form:has(input[name="replacementReference"])').first();
    await form.locator('input[name="externalInvoiceId"]').fill(replacementExternalId);
    await form.locator('input[name="replacementReference"]').fill(firstExternalId);
    await form.locator('input[name="lookupCode"]').fill("LOOKUP-SMOKE-002");
    await form.getByRole("button", { name: "Ghi nhận thay thế", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/operations/finance", { timeout: 15000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Đã thay thế");
    await expectText(page, replacementExternalId);

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectAbsent(page, `Số tiền HĐĐT lệch hóa đơn: ${invoiceNo}`);
  });

  console.log("ok issued amount drift becomes Work mismatch and replacement reconciles snapshot");
}

async function assertVoidMismatchAndExternalCancellation(browser) {
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { status: "VOID" },
  });

  await withLoggedInPage(browser, "billing@nhavista.vn", async (page) => {
    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, `Hóa đơn đã hủy nhưng HĐĐT còn hiệu lực: ${invoiceNo}`);

    await openFinance(page);
    const row = invoiceRow(page);
    await row.getByRole("button", { name: "Xác nhận đã hủy HĐĐT", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/operations/finance", { timeout: 15000 });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Đã hủy");

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectAbsent(page, `Hóa đơn đã hủy nhưng HĐĐT còn hiệu lực: ${invoiceNo}`);
  });

  console.log("ok local VOID stays visible until external HĐĐT cancellation is reconciled");
}

async function assertAuditTrail() {
  const events = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: invoiceId,
      action: { startsWith: "einvoice." },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true, actorId: true, metadata: true },
  });
  const actions = events.map((event) => event.action);
  assertSequence(actions, [
    "einvoice.pending",
    "einvoice.failed",
    "einvoice.issued",
    "einvoice.replaced",
    "einvoice.cancelled",
  ]);

  if (events.some((event) => !event.actorId)) {
    throw new Error("E-invoice audit trail contains an event without actor identity.");
  }

  const failed = events.find((event) => event.action === "einvoice.failed");
  const failedMetadata = failed?.metadata && typeof failed.metadata === "object" && !Array.isArray(failed.metadata)
    ? failed.metadata
    : {};
  if (failedMetadata.errorCode !== "PROVIDER_NOT_CONFIGURED") {
    throw new Error("Failed E-invoice audit event did not preserve PROVIDER_NOT_CONFIGURED.");
  }

  console.log("ok append-only E-invoice audit trail preserves state transitions and actor identity");
}

async function invoiceAuditActions() {
  const events = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: invoiceId,
      action: { startsWith: "einvoice." },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true },
  });
  return events.map((event) => event.action);
}

function assertSequence(actual, expected) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`Unexpected E-invoice audit sequence: ${actual.join(" → ")}; expected ${expected.join(" → ")}.`);
  }
}

async function openFinance(page) {
  const response = await page.goto(`${baseUrl}/operations/finance`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => null);
  if (!response || response.status() >= 400 || new URL(page.url()).pathname !== "/operations/finance") {
    throw new Error(`/operations/finance failed: ${response?.status() ?? "unknown"} ${page.url()}`);
  }
  await expectText(page, invoiceNo);
}

function invoiceRow(page) {
  return page.getByRole("row").filter({ hasText: invoiceNo }).first();
}

async function withLoggedInPage(browser, email, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await login(page, email);
    await run(page);
  } finally {
    await context.close();
  }
}

async function login(page, email) {
  const response = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  if (!response || response.status() >= 400) {
    throw new Error(`/login returned HTTP ${response?.status() ?? "unknown"}`);
  }

  const form = page.locator("form.login-form").first();
  const emailInput = form.locator('input[type="email"]').first();
  await emailInput.click();
  await emailInput.pressSequentially(email);
  await form.locator('input[name="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  await page.waitForTimeout(1000);

  if (new URL(page.url()).pathname.endsWith("/login")) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Login failed for ${email}. ${bodyText.slice(0, 300)}`);
  }
}

async function expectText(page, text) {
  const locator = page.getByText(text, { exact: true });
  if ((await locator.count()) === 0) {
    throw new Error(`Expected visible text not found: ${text}`);
  }
}

async function expectAbsent(page, text) {
  if ((await page.getByText(text, { exact: true }).count()) !== 0) {
    throw new Error(`Unexpected visible text remained: ${text}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

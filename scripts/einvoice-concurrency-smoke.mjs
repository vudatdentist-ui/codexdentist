import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.EINVOICE_CONCURRENCY_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.EINVOICE_CONCURRENCY_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const organizationId = "org_nhavista";
const clinicId = "hcm-q1";
const invoiceA = "einvoice-concurrency-a";
const invoiceB = "einvoice-concurrency-b";
const invoiceNoA = "EINV-CONC-A";
const invoiceNoB = "EINV-CONC-B";
const duplicateExternalId = "EXT-CONC-DUP-001";

async function main() {
  const fixture = await resetFixture();
  const browser = await chromium.launch({ headless: true });

  try {
    await assertSingleProviderClaimUnderConcurrentRequest(browser);
    await assertExternalReferenceCannotBeShared(browser);
    console.log(`ok e-invoice concurrency for ${fixture.patientName}`);
  } finally {
    await browser.close();
    await cleanupFixture();
    await prisma.$disconnect();
  }
}

async function resetFixture() {
  await cleanupFixture();

  const patient = await prisma.patient.findFirst({
    where: { organizationId, clinicId },
    select: { id: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
  if (!patient) throw new Error("E-invoice concurrency smoke requires a seeded patient in hcm-q1.");

  const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.invoice.createMany({
    data: [
      {
        id: invoiceA,
        organizationId,
        clinicId,
        patientId: patient.id,
        invoiceNo: invoiceNoA,
        status: "DRAFT",
        amount: 600_000,
        paidAmount: 0,
        dueDate,
      },
      {
        id: invoiceB,
        organizationId,
        clinicId,
        patientId: patient.id,
        invoiceNo: invoiceNoB,
        status: "DRAFT",
        amount: 700_000,
        paidAmount: 0,
        dueDate,
      },
    ],
  });

  await prisma.invoiceItem.createMany({
    data: [
      {
        id: `${invoiceA}-item`,
        organizationId,
        clinicId,
        patientId: patient.id,
        invoiceId: invoiceA,
        description: "Concurrency invoice A",
        quantity: 1,
        unitPrice: 600_000,
        amount: 600_000,
      },
      {
        id: `${invoiceB}-item`,
        organizationId,
        clinicId,
        patientId: patient.id,
        invoiceId: invoiceB,
        description: "Concurrency invoice B",
        quantity: 1,
        unitPrice: 700_000,
        amount: 700_000,
      },
    ],
  });

  return { patientName: patient.fullName };
}

async function cleanupFixture() {
  await prisma.auditLog.deleteMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: { in: [invoiceA, invoiceB] },
      action: { startsWith: "einvoice." },
    },
  });
  await prisma.invoiceItem.deleteMany({
    where: { invoiceId: { in: [invoiceA, invoiceB] } },
  });
  await prisma.invoice.deleteMany({
    where: {
      organizationId,
      id: { in: [invoiceA, invoiceB] },
    },
  });
}

async function assertSingleProviderClaimUnderConcurrentRequest(browser) {
  const first = await loggedInPage(browser);
  const second = await loggedInPage(browser);

  try {
    await Promise.all([openFinance(first.page), openFinance(second.page)]);
    const firstButton = invoiceRow(first.page, invoiceNoA).getByRole("button", {
      name: "Yêu cầu HĐĐT",
      exact: true,
    });
    const secondButton = invoiceRow(second.page, invoiceNoA).getByRole("button", {
      name: "Yêu cầu HĐĐT",
      exact: true,
    });

    await Promise.all([firstButton.click(), secondButton.click()]);
    await waitForActions(invoiceA, 2);
    await sleep(800);

    const events = await invoiceEvents(invoiceA);
    const actions = events.map((event) => event.action);
    if (
      actions.length !== 2 ||
      actions[0] !== "einvoice.pending" ||
      actions[1] !== "einvoice.failed"
    ) {
      throw new Error(
        `Concurrent issue produced duplicate state transitions: ${actions.join(" → ") || "none"}.`,
      );
    }

    const versions = events.map((event) => Number(metadataRecord(event.metadata).version));
    if (versions[0] !== 1 || versions[1] !== 2) {
      throw new Error(`Unexpected E-invoice state versions under concurrency: ${versions.join(", ")}.`);
    }
  } finally {
    await first.context.close();
    await second.context.close();
  }

  console.log("ok concurrent issue requests serialize to one provider claim");
}

async function assertExternalReferenceCannotBeShared(browser) {
  const first = await loggedInPage(browser);
  const second = await loggedInPage(browser);

  try {
    await openFinance(first.page);
    const firstRow = invoiceRow(first.page, invoiceNoA);
    await firstRow.locator("summary").filter({ hasText: "Đối soát" }).click();
    const firstForm = firstRow.locator('form:has(input[name="providerKey"])').first();
    await firstForm.locator('input[name="externalInvoiceId"]').fill(duplicateExternalId);
    await firstForm.locator('input[name="providerKey"]').fill("external-concurrency");
    await firstForm.getByRole("button", { name: "Xác nhận đã phát hành", exact: true }).click();
    await waitForLatestAction(invoiceA, "einvoice.issued");

    await openFinance(second.page);
    const secondRow = invoiceRow(second.page, invoiceNoB);
    await secondRow.locator("summary").filter({ hasText: "Đối soát" }).click();
    const secondForm = secondRow.locator('form:has(input[name="providerKey"])').first();
    await secondForm.locator('input[name="externalInvoiceId"]').fill(duplicateExternalId);
    await secondForm.locator('input[name="providerKey"]').fill("external-concurrency");
    await secondForm.getByRole("button", { name: "Xác nhận đã phát hành", exact: true }).click();
    await sleep(800);

    const events = await invoiceEvents(invoiceB);
    if (events.some((event) => event.action === "einvoice.issued")) {
      throw new Error("A duplicate external E-invoice reference was attached to a second invoice.");
    }

    await second.page.reload({ waitUntil: "domcontentloaded" }).catch(() => null);
    await second.page.waitForLoadState("networkidle").catch(() => null);
    if ((await second.page.getByText("Mã HĐĐT ngoài hệ thống này đã được gắn với một hóa đơn khác trong cùng tổ chức.", { exact: true }).count()) === 0) {
      throw new Error("Duplicate external reference was rejected without the expected operator notice.");
    }
  } finally {
    await first.context.close();
    await second.context.close();
  }

  console.log("ok external E-invoice reference cannot be shared across invoices");
}

async function loggedInPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await login(page, "billing@nhavista.vn");
  return { context, page };
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  const form = page.locator("form.login-form").first();
  const emailInput = form.locator('input[type="email"]').first();
  await emailInput.click();
  await emailInput.pressSequentially(email);
  await form.locator('input[name="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15000 }).catch(() => null);
  await page.waitForLoadState("networkidle").catch(() => null);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    throw new Error(`Login failed for ${email}.`);
  }
}

async function openFinance(page) {
  await page.goto(`${baseUrl}/operations/finance`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => null);
  if (new URL(page.url()).pathname !== "/operations/finance") {
    throw new Error(`Finance workspace unavailable: ${page.url()}`);
  }
}

function invoiceRow(page, invoiceNo) {
  return page.getByRole("row").filter({ hasText: invoiceNo }).first();
}

async function waitForActions(invoiceId, count, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await prisma.auditLog.count({
      where: {
        organizationId,
        entityType: "Invoice",
        entityId: invoiceId,
        action: { startsWith: "einvoice." },
      },
    });
    if (current >= count) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${count} E-invoice events for ${invoiceId}.`);
}

async function waitForLatestAction(invoiceId, expected, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await invoiceEvents(invoiceId);
    if (events.at(-1)?.action === expected) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${expected} on ${invoiceId}.`);
}

async function invoiceEvents(invoiceId) {
  const events = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: "Invoice",
      entityId: invoiceId,
      action: { startsWith: "einvoice." },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true, metadata: true },
  });
  return events.sort((left, right) => {
    const leftVersion = Number(metadataRecord(left.metadata).version ?? 0);
    const rightVersion = Number(metadataRecord(right.metadata).version ?? 0);
    return leftVersion - rightVersion;
  });
}

function metadataRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(async (error) => {
  console.error(error);
  await cleanupFixture().catch(() => null);
  await prisma.$disconnect().catch(() => null);
  process.exit(1);
});

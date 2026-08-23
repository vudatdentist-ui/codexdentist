import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.STAFF_OPERATIONS_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.STAFF_OPERATIONS_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const organizationId = "org_nhavista";
const source = "STAFF_REFERRAL_SMOKE";
const policyId = "staff-operations-smoke-policy";
const accrualId = "staff-operations-smoke-accrual";
const commissionAmount = 250_000;

async function main() {
  const fixture = await resetFixture();
  const browser = await chromium.launch({ headless: true });

  try {
    await assertManagerSeesUnresolvedReferral(browser);
    await resolveReferral(fixture.dentistEmployeeCode);
    await assertManagerResolutionAndOperations(browser, fixture.dentistName);
    await assertDentistSeesUnifiedReferralIncome(browser, fixture.dentistName);
    await assertBillingCannotOpenOperations(browser);
  } finally {
    await browser.close();
    await cleanupFixture();
  }

  console.log("ok staff operations and unified earnings smoke");
}

async function resetFixture() {
  await cleanupFixture();

  const [receipt, dentistProfile] = await Promise.all([
    prisma.receipt.findFirst({
      where: {
        organizationId,
        clinicId: "hcm-q1",
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
      },
      orderBy: {
        receivedAt: "asc",
      },
    }),
    prisma.staffProfile.findFirst({
      where: {
        organizationId,
        userId: "user-dentist",
      },
      select: {
        employeeCode: true,
        user: {
          select: {
            fullName: true,
          },
        },
      },
    }),
  ]);

  if (!receipt || !dentistProfile) {
    throw new Error("Staff operations smoke prerequisites are missing.");
  }

  await prisma.sourceCommissionPolicy.create({
    data: {
      id: policyId,
      organizationId,
      source,
      name: "Staff referral smoke",
      ownerLabel: "Unassigned smoke beneficiary",
      ratePercent: 25,
      fixedAmount: 0,
      trigger: "COLLECTION_RECEIVED",
      active: true,
    },
  });

  await prisma.sourceCommissionAccrual.create({
    data: {
      id: accrualId,
      organizationId,
      clinicId: receipt.clinicId,
      patientId: receipt.patientId,
      receiptId: receipt.id,
      policyId,
      source,
      baseAmount: 1_000_000,
      ratePercent: 25,
      fixedAmount: 0,
      commissionAmount,
      status: "EARNED",
      earnedAt: new Date(),
    },
  });

  return {
    dentistEmployeeCode: dentistProfile.employeeCode,
    dentistName: dentistProfile.user.fullName,
  };
}

async function resolveReferral(ownerLabel) {
  await prisma.sourceCommissionPolicy.update({
    where: { id: policyId },
    data: { ownerLabel },
  });
}

async function cleanupFixture() {
  await prisma.sourceCommissionAccrual.deleteMany({
    where: {
      organizationId,
      OR: [{ id: accrualId }, { source }],
    },
  });
  await prisma.sourceCommissionPolicy.deleteMany({
    where: {
      organizationId,
      OR: [{ id: policyId }, { source }],
    },
  });
}

async function assertManagerSeesUnresolvedReferral(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page, "manager@nhavista.vn");
    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Hoa hồng giới thiệu chưa gán nhân sự");
    console.log("ok unresolved referral becomes manager Work signal");
  } finally {
    await context.close();
  }
}

async function assertManagerResolutionAndOperations(browser, dentistName) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page, "manager@nhavista.vn");
    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);

    if ((await page.getByText("Hoa hồng giới thiệu chưa gán nhân sự", { exact: true }).count()) !== 0) {
      throw new Error("Resolved referral still appears as a Work signal.");
    }

    const response = await page.goto(`${baseUrl}/operations`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    if (!response || response.status() >= 400) {
      throw new Error(`/operations returned HTTP ${response?.status() ?? "unknown"}.`);
    }
    await expectText(page, "Thu nhập tháng này");
    await expectText(page, dentistName);
    await expectText(page, "Hoa hồng giới thiệu");
    console.log("ok referral resolution feeds canonical Operations workspace");
  } finally {
    await context.close();
  }
}

async function assertDentistSeesUnifiedReferralIncome(browser, dentistName) {
  const context = await browser.newContext({ viewport: { width: 1080, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page, "dentist@nhavista.vn");
    const response = await page.goto(`${baseUrl}/employee-app`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    if (!response || response.status() >= 400) {
      throw new Error(`/employee-app returned HTTP ${response?.status() ?? "unknown"}.`);
    }
    await expectText(page, dentistName);
    await expectText(page, `Giới thiệu · ${source}`);
    await expectText(page, "Thu nhập phát sinh");
    console.log("ok employee self view includes resolved referral earnings");
  } finally {
    await context.close();
  }
}

async function assertBillingCannotOpenOperations(browser) {
  const context = await browser.newContext({ viewport: { width: 1080, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page, "billing@nhavista.vn");
    await page.goto(`${baseUrl}/operations`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    const path = new URL(page.url()).pathname;
    if (path === "/operations") {
      throw new Error("Billing role unexpectedly received Operations management workspace.");
    }
    console.log("ok Operations remains management-only");
  } finally {
    await context.close();
  }
}

async function login(page, email) {
  const response = await page.goto(`${baseUrl}/login`, {
    waitUntil: "domcontentloaded",
  });

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
  await page.waitForTimeout(1200);

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

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

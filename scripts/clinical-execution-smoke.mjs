import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.CLINICAL_EXECUTION_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.CLINICAL_EXECUTION_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const seeded = await resetSmokeCase();
  const browser = await chromium.launch({ headless: true });

  try {
    await assertDentistExecution(browser, seeded);
    await assertBillingReadOnly(browser, seeded);
  } finally {
    await browser.close();
  }

  console.log("ok clinical execution smoke");
}

async function resetSmokeCase() {
  const treatmentCase = await prisma.treatmentService.findUnique({
    where: { id: "smoke-treatment-case" },
    select: {
      id: true,
      patientId: true,
    },
  });

  if (!treatmentCase) {
    throw new Error("Smoke treatment case is missing.");
  }

  const staleAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.treatmentService.update({
      where: { id: treatmentCase.id },
      data: {
        status: "IN_PROGRESS",
        currentProgressPercent: 40,
        currentStepSequence: 2,
      },
    }),
    prisma.treatmentServiceProgressEvent.update({
      where: { id: "smoke-treatment-progress" },
      data: {
        fromProgressPercent: 20,
        toProgressPercent: 40,
        progressDeltaPercent: 20,
        occurredAt: staleAt,
      },
    }),
    prisma.treatmentServiceProgressEvent.deleteMany({
      where: {
        treatmentServiceId: treatmentCase.id,
        id: {
          not: "smoke-treatment-progress",
        },
      },
    }),
    prisma.compensationAccrual.deleteMany({
      where: {
        treatmentServiceId: treatmentCase.id,
        progressEventId: {
          not: "smoke-treatment-progress",
        },
      },
    }),
    prisma.auditLog.deleteMany({
      where: {
        action: "treatment_service.progress_recorded",
        metadata: {
          path: ["treatmentServiceId"],
          equals: treatmentCase.id,
        },
      },
    }),
  ]);

  return treatmentCase;
}

async function assertDentistExecution(browser, treatmentCase) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page, "dentist@nhavista.vn");

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Ca điều trị chậm: Trám Composite kiểm thử");

    const casePath = `/patients/${encodeURIComponent(treatmentCase.patientId)}/treatments/${encodeURIComponent(treatmentCase.id)}`;
    await page.goto(`${baseUrl}${casePath}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);

    const form = page.locator("form[data-treatment-progress-form]");
    if ((await form.count()) !== 1) {
      throw new Error("Dentist cannot see the Treatment Case progress form.");
    }

    await form.locator('select[name="toProgressPercent"]').selectOption("70");
    await form.locator('textarea[name="note"]').fill("Clinical execution smoke 40 → 70");
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "progress-recorded", {
        timeout: 15000,
      }),
      form.locator('button[type="submit"]').click(),
    ]);
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "70%");

    const persisted = await prisma.treatmentService.findUnique({
      where: { id: treatmentCase.id },
      select: {
        currentProgressPercent: true,
        currentStepSequence: true,
        status: true,
        progressEvents: {
          orderBy: { occurredAt: "desc" },
          take: 1,
          select: {
            id: true,
            fromProgressPercent: true,
            toProgressPercent: true,
            progressDeltaPercent: true,
          },
        },
      },
    });

    if (
      !persisted ||
      Number(persisted.currentProgressPercent) !== 70 ||
      persisted.currentStepSequence !== 2 ||
      persisted.status !== "IN_PROGRESS" ||
      Number(persisted.progressEvents[0]?.fromProgressPercent) !== 40 ||
      Number(persisted.progressEvents[0]?.toProgressPercent) !== 70 ||
      Number(persisted.progressEvents[0]?.progressDeltaPercent) !== 30
    ) {
      throw new Error(`Treatment progress did not persist correctly: ${JSON.stringify(persisted)}`);
    }

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "treatment_service.progress_recorded",
        entityId: persisted.progressEvents[0]?.id,
      },
      select: { id: true },
    });

    if (!audit) {
      throw new Error("Treatment progress audit record is missing.");
    }

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    if ((await page.getByText("Ca điều trị chậm: Trám Composite kiểm thử", { exact: true }).count()) !== 0) {
      throw new Error("Stalled-treatment Work signal did not clear after fresh progress.");
    }

    await page.goto(`${baseUrl}${casePath}`, { waitUntil: "domcontentloaded" });
    const regressionForm = page.locator("form[data-treatment-progress-form]");
    await regressionForm.locator('select[name="toProgressPercent"]').evaluate((select) => {
      const option = document.createElement("option");
      option.value = "20";
      option.textContent = "Injected regression";
      select.append(option);
      select.value = "20";
    });
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "progress-regression", {
        timeout: 15000,
      }),
      regressionForm.locator('button[type="submit"]').click(),
    ]);

    const afterRegression = await prisma.treatmentService.findUnique({
      where: { id: treatmentCase.id },
      select: { currentProgressPercent: true },
    });

    if (Number(afterRegression?.currentProgressPercent) !== 70) {
      throw new Error("Regression guard allowed Treatment Case progress to move backwards.");
    }

    console.log("ok dentist Treatment Case execution, Work resolution, and regression guard");
  } finally {
    await context.close();
  }
}

async function assertBillingReadOnly(browser, treatmentCase) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    await login(page, "billing@nhavista.vn");
    const casePath = `/patients/${encodeURIComponent(treatmentCase.patientId)}/treatments/${encodeURIComponent(treatmentCase.id)}`;
    const response = await page.goto(`${baseUrl}${casePath}`, {
      waitUntil: "domcontentloaded",
    });

    if (!response || response.status() >= 400) {
      throw new Error(`Billing Treatment Case route returned HTTP ${response?.status() ?? "unknown"}.`);
    }

    if ((await page.locator("form[data-treatment-progress-form]").count()) !== 0) {
      throw new Error("Billing role unexpectedly received the Treatment Case progress form.");
    }

    if ((await page.getByRole("heading", { name: "Lâm sàng" }).count()) !== 0) {
      throw new Error("Billing role unexpectedly received clinical context in Treatment Case.");
    }

    console.log("ok billing Treatment Case stays read-only and clinical context remains hidden");
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
  await page.waitForTimeout(1500);

  const currentPath = new URL(page.url()).pathname;
  if (currentPath.endsWith("/login")) {
    const bodyText = await page.locator("body").innerText().catch(() => "");
    throw new Error(
      `Login failed for ${email}; still on ${page.url()}. ${bodyText.slice(0, 300)}`,
    );
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

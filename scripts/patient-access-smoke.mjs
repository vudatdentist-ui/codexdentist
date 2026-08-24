import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.PATIENT_ACCESS_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.PATIENT_ACCESS_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ids = {
  chair: "smoke-patient-access-chair",
  provider: "smoke-patient-access-provider",
  main: "smoke-patient-access-main",
  noShow: "smoke-patient-access-no-show",
  transitionRace: "smoke-patient-access-transition-race",
  recoveryRace: "smoke-patient-access-recovery-race",
  outscopeClinic: "smoke-patient-access-outscope-clinic",
  outscopePatient: "smoke-patient-access-outscope-patient",
};
const fixtureAppointmentIds = [ids.main, ids.noShow, ids.transitionRace, ids.recoveryRace];
const recoverySubjects = fixtureAppointmentIds.map((id) => `No-show follow-up · ${id}`);
const outscopeName = "Patient Access Out-of-scope Sentinel";

async function main() {
  const fixture = await resetFixture();
  const browser = await chromium.launch({ headless: true });

  try {
    const authState = await loginAndCapture(browser, "frontdesk@nhavista.vn");
    await assertScopeAndOperationalFlow(browser, authState, fixture);
    await assertConcurrentTransition(browser, authState, fixture);
    await assertNoShowRecovery(browser, authState, fixture);
    await assertConcurrentRecovery(browser, authState, fixture);
    await assertBillingBoundaries(browser);
    console.log("ok patient access operational, scope, concurrency, and recovery smoke");
  } finally {
    await browser.close();
    await cleanupFixture(fixture).catch((error) => {
      console.warn(`patient access cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    });
    await prisma.$disconnect();
  }
}

async function resetFixture() {
  const organization = await prisma.organization.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!organization) throw new Error("Patient access smoke requires an organization.");

  const [clinic, frontDesk, dentistTemplate] = await Promise.all([
    prisma.clinic.findFirst({
      where: { organizationId: organization.id, active: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findUnique({
      where: { email: "frontdesk@nhavista.vn" },
      select: { id: true, organizationId: true },
    }),
    prisma.user.findUnique({
      where: { email: "dentist@nhavista.vn" },
      select: { organizationId: true, passwordHash: true },
    }),
  ]);
  if (!clinic || !frontDesk || !dentistTemplate) {
    throw new Error("Patient access smoke requires seeded clinic/front desk/dentist records.");
  }
  if (frontDesk.organizationId !== organization.id || dentistTemplate.organizationId !== organization.id) {
    throw new Error("Smoke users are not in the expected organization.");
  }

  const patient = await prisma.patient.findFirst({
    where: { organizationId: organization.id, clinicId: clinic.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, fullName: true },
  });
  if (!patient) throw new Error("Patient access smoke requires an in-scope patient.");

  await clearFixtureAuditAndActivities(organization.id);
  await prisma.appointment.deleteMany({ where: { id: { in: fixtureAppointmentIds } } });
  await prisma.userClinic.deleteMany({ where: { userId: ids.provider } });
  await prisma.user.deleteMany({ where: { id: ids.provider } });
  await prisma.patient.deleteMany({ where: { id: ids.outscopePatient } });
  await prisma.clinic.deleteMany({ where: { id: ids.outscopeClinic } });

  const provider = await prisma.user.create({
    data: {
      id: ids.provider,
      organizationId: organization.id,
      email: "patient-access-smoke-provider@codexdentist.test",
      fullName: "Patient Access Smoke Dentist",
      passwordHash: dentistTemplate.passwordHash,
      role: "DENTIST",
      active: true,
      operationalStatus: "READY",
      operationalStatusUpdatedAt: new Date(),
    },
    select: { id: true },
  });
  await prisma.userClinic.create({
    data: {
      userId: provider.id,
      clinicId: clinic.id,
    },
  });

  await prisma.chair.upsert({
    where: { id: ids.chair },
    update: {
      clinicId: clinic.id,
      name: "Ghế Patient Access Smoke",
      active: true,
      operationalStatus: "READY",
      operationalStatusUpdatedAt: new Date(),
    },
    create: {
      id: ids.chair,
      clinicId: clinic.id,
      name: "Ghế Patient Access Smoke",
      active: true,
      operationalStatus: "READY",
      operationalStatusUpdatedAt: new Date(),
    },
  });

  const outscopeClinic = await prisma.clinic.create({
    data: {
      id: ids.outscopeClinic,
      organizationId: organization.id,
      name: "Patient Access Out-of-scope Clinic",
      city: "Ho Chi Minh City",
      address: "Patient access smoke fixture",
      phone: "0999999930",
      active: true,
    },
    select: { id: true },
  });
  await prisma.patient.create({
    data: {
      id: ids.outscopePatient,
      organizationId: organization.id,
      clinicId: outscopeClinic.id,
      fullName: outscopeName,
      dateOfBirth: new Date("1992-01-01T00:00:00.000Z"),
      phone: "0999999931",
    },
  });

  const now = Date.now();
  const starts = [
    new Date(now + 45 * 60_000),
    new Date(now),
    new Date(now + 85 * 60_000),
    new Date(now - 75 * 60_000),
  ];
  await prisma.appointment.createMany({
    data: [
      appointmentData(ids.main, "REQUESTED", starts[0], clinic.id, patient.id, provider.id),
      appointmentData(ids.noShow, "CONFIRMED", starts[1], clinic.id, patient.id, provider.id),
      appointmentData(ids.transitionRace, "CONFIRMED", starts[2], clinic.id, patient.id, provider.id),
      appointmentData(ids.recoveryRace, "NO_SHOW", starts[3], clinic.id, patient.id, provider.id),
    ],
  });

  return {
    organizationId: organization.id,
    clinicId: clinic.id,
    providerId: provider.id,
    patientId: patient.id,
    patientName: patient.fullName,
    mainDate: vietnamDate(starts[0]),
    noShowDate: vietnamDate(starts[1]),
    raceDate: vietnamDate(starts[2]),
    recoveryDate: vietnamDate(starts[3]),
  };
}

function appointmentData(id, status, startsAt, clinicId, patientId, providerId) {
  return {
    id,
    clinicId,
    patientId,
    providerId,
    chairId: null,
    status,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 30 * 60_000),
    reason: `Patient access smoke ${id}`,
    source: "smoke",
  };
}

async function assertScopeAndOperationalFlow(browser, storageState, fixture) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/schedule?date=${fixture.mainDate}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    assertNotSerialized(await page.content(), outscopeName, "canonical Schedule");
    await expectRow(page, ids.main);

    await page.goto(`${baseUrl}/schedule/legacy`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    assertNotSerialized(await page.content(), outscopeName, "legacy Schedule compatibility surface");

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Lịch hẹn cần xác nhận");

    await page.goto(`${baseUrl}/schedule?date=${fixture.mainDate}`, { waitUntil: "domcontentloaded" });
    await submitRowButton(page, ids.main, "Xác nhận");
    await expectAppointmentStatus(ids.main, "CONFIRMED");

    await submitRowButton(page, ids.main, "Đã đến");
    await expectAppointmentStatus(ids.main, "ARRIVED");

    let row = await expectRow(page, ids.main);
    await row.locator('select[name="chairId"]').selectOption(ids.chair);
    await submitRowButton(page, ids.main, "Vào ghế");
    await expectAppointmentStatus(ids.main, "IN_CHAIR");
    await assertResourceStatus(fixture, "BUSY");

    row = await expectRow(page, ids.main);
    const completeButton = row.getByRole("button", { name: "Hoàn tất", exact: true });
    const completeForm = completeButton.locator("xpath=ancestor::form");
    await completeForm.locator('input[name="status"]').evaluate((input) => {
      input.value = "ARRIVED";
    });
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "invalid-transition", { timeout: 15000 }),
      completeButton.click(),
    ]);
    await expectAppointmentStatus(ids.main, "IN_CHAIR");

    await page.goto(`${baseUrl}/schedule?date=${fixture.mainDate}`, { waitUntil: "domcontentloaded" });
    await submitRowButton(page, ids.main, "Hoàn tất");
    await expectAppointmentStatus(ids.main, "COMPLETED");
    await assertResourceStatus(fixture, "READY");

    const audits = await prisma.auditLog.count({
      where: {
        organizationId: fixture.organizationId,
        entityType: "Appointment",
        entityId: ids.main,
        action: "appointment.status_updated",
      },
    });
    if (audits !== 4) {
      throw new Error(`Expected four accepted status transitions for main appointment, got ${audits}.`);
    }

    console.log("ok patient access confirmation → arrival → chair → completion and scope isolation");
  } finally {
    await context.close();
  }
}

async function assertConcurrentTransition(browser, storageState, fixture) {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 900 }, storageState }),
    browser.newContext({ viewport: { width: 1280, height: 900 }, storageState }),
  ]);
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    const url = `${baseUrl}/schedule?date=${fixture.raceDate}`;
    await Promise.all([
      pageA.goto(url, { waitUntil: "domcontentloaded" }),
      pageB.goto(url, { waitUntil: "domcontentloaded" }),
    ]);
    const [rowA, rowB] = await Promise.all([expectRow(pageA, ids.transitionRace), expectRow(pageB, ids.transitionRace)]);
    const arrivedButton = rowA.getByRole("button", { name: "Đã đến", exact: true });
    const noShowButton = rowB.getByRole("button", { name: "No-show", exact: true });

    await Promise.allSettled([arrivedButton.click(), noShowButton.click()]);
    await waitFor(async () => {
      const appointment = await prisma.appointment.findUnique({
        where: { id: ids.transitionRace },
        select: { status: true },
      });
      return appointment && ["ARRIVED", "NO_SHOW"].includes(appointment.status);
    }, "concurrent transition persistence");

    const [appointment, audits] = await Promise.all([
      prisma.appointment.findUnique({ where: { id: ids.transitionRace }, select: { status: true } }),
      prisma.auditLog.count({
        where: {
          organizationId: fixture.organizationId,
          entityType: "Appointment",
          entityId: ids.transitionRace,
          action: "appointment.status_updated",
        },
      }),
    ]);
    if (!appointment || !["ARRIVED", "NO_SHOW"].includes(appointment.status)) {
      throw new Error(`Concurrent transition ended in unexpected state ${appointment?.status ?? "missing"}.`);
    }
    if (audits !== 1) {
      throw new Error(`Concurrent transition should accept exactly one state change; audit count=${audits}.`);
    }

    console.log(`ok concurrent CONFIRMED transition serialized to ${appointment.status}`);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

async function assertNoShowRecovery(browser, storageState, fixture) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, storageState });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/schedule?date=${fixture.noShowDate}`, { waitUntil: "domcontentloaded" });
    await submitRowButton(page, ids.noShow, "No-show");
    await expectAppointmentStatus(ids.noShow, "NO_SHOW");

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    await expectText(page, "Cần chăm sóc sau no-show");

    await page.goto(`${baseUrl}/care?appointmentId=${ids.noShow}`, { waitUntil: "domcontentloaded" });
    const row = page.locator(`#no-show-${ids.noShow}`);
    if ((await row.count()) !== 1) throw new Error("No-show did not appear in Care.");
    await row.locator('input[name="note"]').fill("Đã gọi, bệnh nhân sẽ đặt lại lịch.");
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "no-show-recovered", { timeout: 15000 }),
      row.getByRole("button", { name: "Ghi nhận đã liên hệ", exact: true }).click(),
    ]);

    const subject = `No-show follow-up · ${ids.noShow}`;
    const [activityCount, auditCount] = await Promise.all([
      prisma.crmActivity.count({
        where: { organizationId: fixture.organizationId, patientId: fixture.patientId, subject, completedAt: { not: null } },
      }),
      countRecoveryAudits(fixture.organizationId, ids.noShow),
    ]);
    if (activityCount !== 1 || auditCount !== 1) {
      throw new Error(`No-show recovery persistence mismatch: activities=${activityCount}, audits=${auditCount}.`);
    }

    await page.goto(`${baseUrl}/work`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => null);
    const unresolved = page.locator(`a[href*="appointmentId=${ids.noShow}"]`).filter({ hasText: "Cần chăm sóc sau no-show" });
    if ((await unresolved.count()) !== 0) {
      throw new Error("No-show Work signal did not clear after recorded recovery.");
    }

    console.log("ok no-show → Work/Care → recorded recovery → signal cleared");
  } finally {
    await context.close();
  }
}

async function assertConcurrentRecovery(browser, storageState, fixture) {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 900 }, storageState }),
    browser.newContext({ viewport: { width: 1280, height: 900 }, storageState }),
  ]);
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()));

  try {
    const url = `${baseUrl}/care?appointmentId=${ids.recoveryRace}`;
    await Promise.all([
      pageA.goto(url, { waitUntil: "domcontentloaded" }),
      pageB.goto(url, { waitUntil: "domcontentloaded" }),
    ]);
    const rowA = pageA.locator(`#no-show-${ids.recoveryRace}`);
    const rowB = pageB.locator(`#no-show-${ids.recoveryRace}`);
    if ((await rowA.count()) !== 1 || (await rowB.count()) !== 1) {
      throw new Error("Recovery-race no-show is missing from Care.");
    }
    await Promise.all([
      rowA.locator('input[name="note"]').fill("Concurrent recovery A"),
      rowB.locator('input[name="note"]').fill("Concurrent recovery B"),
    ]);
    await Promise.allSettled([
      rowA.getByRole("button", { name: "Ghi nhận đã liên hệ", exact: true }).click(),
      rowB.getByRole("button", { name: "Ghi nhận đã liên hệ", exact: true }).click(),
    ]);

    const subject = `No-show follow-up · ${ids.recoveryRace}`;
    await waitFor(
      async () => (await prisma.crmActivity.count({ where: { organizationId: fixture.organizationId, subject } })) >= 1,
      "concurrent no-show recovery persistence",
    );
    const [activityCount, auditCount] = await Promise.all([
      prisma.crmActivity.count({ where: { organizationId: fixture.organizationId, subject } }),
      countRecoveryAudits(fixture.organizationId, ids.recoveryRace),
    ]);
    if (activityCount !== 1 || auditCount !== 1) {
      throw new Error(`Concurrent recovery was not idempotent: activities=${activityCount}, audits=${auditCount}.`);
    }

    console.log("ok concurrent no-show recovery is idempotent");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
}

async function assertBillingBoundaries(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await login(page, "billing@nhavista.vn");
    for (const route of ["/schedule", "/care"]) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => null);
      if (new URL(page.url()).pathname === route) {
        throw new Error(`Billing role unexpectedly retained access to ${route}.`);
      }
    }
    console.log("ok Billing cannot access Schedule or Care patient-access surfaces");
  } finally {
    await context.close();
  }
}

async function loginAndCapture(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await login(page, email);
    return await context.storageState();
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
  await page.waitForTimeout(750);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Login failed for ${email}. ${body.slice(0, 250)}`);
  }
}

async function submitRowButton(page, appointmentId, label) {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
  const row = await expectRow(page, appointmentId);
  const button = row.getByRole("button", { name: label, exact: true });
  await button.click();
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => null);
}

async function expectRow(page, appointmentId) {
  const row = page.locator(`#appointment-${appointmentId}`);
  await row.waitFor({ state: "visible", timeout: 10000 });
  return row;
}

async function expectText(page, text) {
  await page.getByText(text, { exact: true }).first().waitFor({ state: "visible", timeout: 10000 });
}

async function expectAppointmentStatus(appointmentId, status) {
  await waitFor(async () => {
    const appointment = await prisma.appointment.findUnique({ where: { id: appointmentId }, select: { status: true } });
    return appointment?.status === status;
  }, `${appointmentId} status ${status}`);
}

async function assertResourceStatus(fixture, status) {
  const [chair, provider] = await Promise.all([
    prisma.chair.findUnique({ where: { id: ids.chair }, select: { operationalStatus: true } }),
    prisma.user.findUnique({ where: { id: fixture.providerId }, select: { operationalStatus: true } }),
  ]);
  if (chair?.operationalStatus !== status || provider?.operationalStatus !== status) {
    throw new Error(
      `Resource state mismatch: expected ${status}, chair=${chair?.operationalStatus}, provider=${provider?.operationalStatus}.`,
    );
  }
}

function assertNotSerialized(html, sentinel, surface) {
  if (html.includes(sentinel)) {
    throw new Error(`${surface} serialized an out-of-scope patient.`);
  }
}

async function countRecoveryAudits(organizationId, appointmentId) {
  return prisma.auditLog.count({
    where: {
      organizationId,
      action: "patient_access.no_show_recovered",
      metadata: { path: ["appointmentId"], equals: appointmentId },
    },
  });
}

async function clearFixtureAuditAndActivities(organizationId) {
  const activities = await prisma.crmActivity.findMany({
    where: { organizationId, subject: { in: recoverySubjects } },
    select: { id: true },
  });
  const activityIds = activities.map((activity) => activity.id);
  await prisma.auditLog.deleteMany({
    where: {
      organizationId,
      OR: [
        { entityType: "Appointment", entityId: { in: fixtureAppointmentIds } },
        ...(activityIds.length ? [{ entityType: "CrmActivity", entityId: { in: activityIds } }] : []),
      ],
    },
  });
  await prisma.crmActivity.deleteMany({
    where: { organizationId, subject: { in: recoverySubjects } },
  });
}

async function waitFor(check, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function vietnamDate(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

async function cleanupFixture(fixture) {
  await clearFixtureAuditAndActivities(fixture.organizationId);
  await prisma.appointment.deleteMany({ where: { id: { in: fixtureAppointmentIds } } });
  await prisma.chair.deleteMany({ where: { id: ids.chair } });
  await prisma.userClinic.deleteMany({ where: { userId: fixture.providerId } });
  await prisma.user.deleteMany({
    where: { id: fixture.providerId, organizationId: fixture.organizationId },
  });
  await prisma.patient.deleteMany({ where: { id: ids.outscopePatient } });
  await prisma.clinic.deleteMany({ where: { id: ids.outscopeClinic } });
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => null);
  process.exitCode = 1;
});
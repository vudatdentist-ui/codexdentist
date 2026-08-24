import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

const baseUrl = process.env.PATIENT_360_BASE_URL ?? "http://127.0.0.1:3000";
const password = process.env.PATIENT_360_PASSWORD ?? "CodexSmoke2026!";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const authStateByEmail = new Map();
const organizationId = "org_nhavista";
const actors = {
  manager: {
    id: "phase4-smoke-manager",
    email: "phase4-manager@nhavista.vn",
    templateEmail: "manager@nhavista.vn",
    fullName: "Phase 4 Smoke Manager",
  },
  clinical: {
    id: "phase4-smoke-hygienist",
    email: "phase4-hygienist@nhavista.vn",
    templateEmail: "hygienist@nhavista.vn",
    fullName: "Phase 4 Smoke Hygienist",
  },
  billing: {
    id: "phase4-smoke-billing",
    email: "phase4-billing@nhavista.vn",
    templateEmail: "billing@nhavista.vn",
    fullName: "Phase 4 Smoke Billing",
  },
};
let patientId = null;

async function main() {
  let browser = null;
  const suffix = String(Date.now()).slice(-8);
  const initialName = `Phase 4 Smoke ${suffix}`;
  const updatedName = `${initialName} Updated`;
  const phone = `09${suffix}`;

  try {
    await seedActorFixtures();
    browser = await chromium.launch({ headless: true });
    patientId = await assertCanonicalIntakeAndEdit(browser, { initialName, updatedName, phone });
    await assertClinicalTimelineAndCompatibility(browser, { patientId, updatedName });
    await assertBillingIsReadOnly(browser, patientId);
    console.log("ok Patient 360 Phase 4 native workflow smoke");
  } finally {
    if (browser) await browser.close();
    if (patientId) await cleanupFixture(patientId);
    await cleanupActorFixtures();
  }
}

async function seedActorFixtures() {
  await cleanupActorFixtures();

  for (const actor of Object.values(actors)) {
    const template = await prisma.user.findUnique({
      where: { email: actor.templateEmail },
      select: {
        organizationId: true,
        passwordHash: true,
        role: true,
        clinics: { select: { clinicId: true } },
        roleAssignments: {
          where: { active: true },
          select: {
            organizationId: true,
            clinicId: true,
            scopeKey: true,
            role: true,
            active: true,
          },
        },
      },
    });

    if (!template || template.organizationId !== organizationId) {
      throw new Error(`Phase 4 smoke template user is missing or out of scope: ${actor.templateEmail}`);
    }

    await prisma.user.create({
      data: {
        id: actor.id,
        organizationId: template.organizationId,
        email: actor.email,
        fullName: actor.fullName,
        passwordHash: template.passwordHash,
        role: template.role,
        active: true,
        mustChangePassword: false,
      },
    });

    if (template.clinics.length > 0) {
      await prisma.userClinic.createMany({
        data: template.clinics.map(({ clinicId }) => ({ userId: actor.id, clinicId })),
      });
    }

    if (template.roleAssignments.length > 0) {
      await prisma.userRoleAssignment.createMany({
        data: template.roleAssignments.map((assignment) => ({
          organizationId: assignment.organizationId,
          userId: actor.id,
          clinicId: assignment.clinicId,
          scopeKey: assignment.scopeKey,
          role: assignment.role,
          active: assignment.active,
        })),
      });
    }
  }

  console.log("ok isolated Patient 360 smoke actors");
}

async function cleanupActorFixtures() {
  const actorIds = Object.values(actors).map((actor) => actor.id);
  const actorEmails = Object.values(actors).map((actor) => actor.email);
  const existing = await prisma.user.findMany({
    where: { OR: [{ id: { in: actorIds } }, { email: { in: actorEmails } }] },
    select: { id: true },
  });
  const ids = existing.map((user) => user.id);

  if (ids.length === 0) return;

  await prisma.auditLog.deleteMany({
    where: {
      organizationId,
      OR: [
        { actorId: { in: ids } },
        { entityType: "User", entityId: { in: ids } },
      ],
    },
  });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRoleAssignment.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userClinic.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  authStateByEmail.clear();
}

async function assertCanonicalIntakeAndEdit(browser, { initialName, updatedName, phone }) {
  return withLoggedInPage(browser, actors.manager.email, async (page) => {
    await open(page, "/patients");
    await expectText(page, "Hồ sơ bệnh nhân 360");

    await page.getByRole("button", { name: "Thêm bệnh nhân", exact: true }).click();
    const createForm = page.locator("form").filter({ has: page.locator('input[name="fullName"]') }).first();
    await createForm.locator('input[name="fullName"]').fill(initialName);
    await createForm.locator('input[name="phone"]').fill(phone);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "patient-created", { timeout: 20_000 }),
      createForm.getByRole("button", { name: "Tạo hồ sơ", exact: true }).click(),
    ]);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForURL((url) => /^\/patients\/[^/]+$/.test(url.pathname), { timeout: 15_000 });

    const createdPatientId = decodeURIComponent(new URL(page.url()).pathname.split("/").filter(Boolean)[1] ?? "");
    if (!createdPatientId) throw new Error("Patient 360 intake did not resolve a canonical patient id.");
    await expectText(page, initialName);
    await expectText(page, "Thông tin hành chính");
    await expectText(page, "Khám & kế hoạch điều trị");
    await expectText(page, "Odontogram");
    await expectText(page, "Dịch vụ điều trị");
    await expectText(page, "Timeline bệnh án");

    await page.getByRole("button", { name: "Chỉnh sửa", exact: true }).click();
    const editForm = page.locator("form").filter({ has: page.locator(`input[name="patientId"][value="${createdPatientId}"]`) }).filter({ has: page.locator('input[name="fullName"]') }).first();
    await editForm.locator('input[name="fullName"]').fill(updatedName);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "patient-updated", { timeout: 20_000 }),
      editForm.getByRole("button", { name: "Lưu hồ sơ", exact: true }).click(),
    ]);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForURL((url) => url.pathname === `/patients/${encodeURIComponent(createdPatientId)}`, { timeout: 15_000 });
    await expectText(page, updatedName);

    const persisted = await prisma.patient.findFirst({
      where: { id: createdPatientId, organizationId },
      select: { fullName: true, phone: true },
    });
    if (!persisted || persisted.fullName !== updatedName || persisted.phone !== phone) {
      throw new Error(`Canonical patient create/edit did not persist: ${JSON.stringify(persisted)}`);
    }

    await open(page, "/patient-management");
    await page.waitForURL((url) => url.pathname === "/patients", { timeout: 15_000 });
    console.log("ok canonical Patients owns intake/edit and legacy patient-management redirects");
    return createdPatientId;
  });
}

async function assertClinicalTimelineAndCompatibility(browser, { patientId: id, updatedName }) {
  await withLoggedInPage(browser, actors.clinical.email, async (page) => {
    await open(page, `/journey?patientId=${encodeURIComponent(id)}`);
    await page.waitForURL((url) => url.pathname === `/patients/${encodeURIComponent(id)}`, { timeout: 15_000 });
    await expectText(page, updatedName);

    await open(page, `/clinical?patientId=${encodeURIComponent(id)}`);
    await page.waitForURL((url) => url.pathname === `/patients/${encodeURIComponent(id)}`, { timeout: 15_000 });
    await expectText(page, "Khám & kế hoạch điều trị");

    const clinicalForm = page.locator("form").filter({ has: page.locator('textarea[name="subjective"]') }).first();
    const clinicalButton = clinicalForm.getByRole("button", { name: "Thêm vào timeline", exact: true });
    if (await clinicalButton.isDisabled()) throw new Error("Hygienist unexpectedly cannot add a Patient 360 clinical note.");
    await clinicalForm.locator('textarea[name="subjective"]').fill("Phase 4 clinical smoke");
    await clinicalForm.locator('textarea[name="assessment"]').fill("Phase 4 assessment");
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "clinical-created", { timeout: 20_000 }),
      clinicalButton.click(),
    ]);
    await page.waitForLoadState("networkidle").catch(() => null);
    await page.waitForURL((url) => url.pathname === `/patients/${encodeURIComponent(id)}`, { timeout: 15_000 });

    const note = await prisma.clinicalNote.findFirst({
      where: { patientId: id, subjective: "Phase 4 clinical smoke" },
      orderBy: { createdAt: "desc" },
      select: { id: true, lockedAt: true },
    });
    if (!note?.lockedAt) throw new Error("Patient 360 clinical note was not finalized/auditable as expected.");
    const clinicalAudit = await prisma.auditLog.findFirst({
      where: { organizationId, action: "clinical_note.created", entityId: note.id },
      select: { id: true },
    });
    if (!clinicalAudit) throw new Error("Patient 360 clinical note audit record is missing.");

    const commentForm = page.locator("form").filter({ has: page.locator('textarea[name="body"]') }).first();
    await commentForm.locator('textarea[name="body"]').fill("Phase 4 timeline smoke");
    await Promise.all([
      page.waitForURL((url) => url.searchParams.get("notice") === "journey-comment-created", { timeout: 20_000 }),
      commentForm.getByRole("button", { name: "Thêm vào timeline", exact: true }).click(),
    ]);
    await page.waitForLoadState("networkidle").catch(() => null);

    const comment = await prisma.journeyComment.findFirst({
      where: { organizationId, patientId: id, body: "Phase 4 timeline smoke" },
      select: { id: true },
    });
    if (!comment) throw new Error("Patient 360 timeline comment did not persist.");

    console.log("ok Journey/Clinical compatibility delegates into native Patient 360 with audited clinical/timeline writes");
  });
}

async function assertBillingIsReadOnly(browser, id) {
  await withLoggedInPage(browser, actors.billing.email, async (page) => {
    await open(page, `/patients/${encodeURIComponent(id)}`);
    if (new URL(page.url()).pathname !== `/patients/${encodeURIComponent(id)}`) {
      throw new Error("Billing could not open authorized Patient 360 context.");
    }
    const clinicalForm = page.locator("form").filter({ has: page.locator('textarea[name="subjective"]') }).first();
    if ((await clinicalForm.count()) !== 1) throw new Error("Patient 360 clinical context is missing for Billing read-only audit.");
    if (!(await clinicalForm.getByRole("button", { name: "Thêm vào timeline", exact: true }).isDisabled())) {
      throw new Error("Billing unexpectedly received Patient 360 clinical mutation capability.");
    }
    console.log("ok Billing sees Patient 360 context without clinical mutation capability");
  });
}

async function withLoggedInPage(browser, email, run) {
  const stored = authStateByEmail.get(email);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    ...(stored ? { storageState: stored } : {}),
  });
  const page = await context.newPage();
  try {
    if (!stored) {
      await login(page, email);
      authStateByEmail.set(email, await context.storageState());
    }
    return await run(page);
  } finally {
    await context.close();
  }
}

async function login(page, email) {
  const response = await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  if (!response || response.status() >= 400) throw new Error(`/login returned HTTP ${response?.status() ?? "unknown"}`);
  const form = page.locator("form.login-form").first();
  await form.locator('input[type="email"]').fill(email);
  await form.locator('input[name="password"]').fill(password);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 20_000 }).catch(() => null);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => null);
  if (new URL(page.url()).pathname.endsWith("/login")) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Login failed for ${email} at ${page.url()}. ${body.slice(0, 300)}`);
  }
}

async function open(page, path) {
  const response = await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => null);
  if (!response || response.status() >= 400) throw new Error(`${path} returned HTTP ${response?.status() ?? "unknown"}`);
}

async function expectText(page, text) {
  if ((await page.getByText(text, { exact: true }).count()) === 0) {
    throw new Error(`Expected Patient 360 text not found: ${text}`);
  }
}

async function cleanupFixture(id) {
  const [notes, comments, state, files] = await Promise.all([
    prisma.clinicalNote.findMany({ where: { patientId: id }, select: { id: true } }),
    prisma.journeyComment.findMany({ where: { patientId: id }, select: { id: true } }),
    prisma.patientJourneyState.findUnique({ where: { patientId: id }, select: { id: true } }),
    prisma.patientFile.findMany({ where: { patientId: id }, select: { id: true } }),
  ]);
  const entityIds = [id, ...notes.map((item) => item.id), ...comments.map((item) => item.id), ...files.map((item) => item.id), state?.id].filter(Boolean);

  await prisma.auditLog.deleteMany({ where: { organizationId, entityId: { in: entityIds } } });
  await prisma.journeyCommentAttachment.deleteMany({ where: { comment: { patientId: id } } });
  await prisma.journeyComment.deleteMany({ where: { patientId: id } });
  await prisma.patientFile.deleteMany({ where: { patientId: id } });
  await prisma.patientOdontogramRevision.deleteMany({ where: { patientId: id } });
  await prisma.patientOdontogram.deleteMany({ where: { patientId: id } });
  await prisma.patientJourneyState.deleteMany({ where: { patientId: id } });
  await prisma.clinicalNote.deleteMany({ where: { patientId: id } });
  await prisma.patientConsent.deleteMany({ where: { patientId: id } });
  await prisma.patient.deleteMany({ where: { id, organizationId } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

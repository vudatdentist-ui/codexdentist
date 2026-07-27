import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.INTEGRATION_BASE_URL ?? "http://127.0.0.1:3000";
const integrationOwnerEmail = process.env.INTEGRATION_OWNER_EMAIL ?? "owner@nhavista.vn";
const integrationOwnerPassword = process.env.INTEGRATION_OWNER_PASSWORD ?? "demo1234";
const integrationPatientEmail = process.env.INTEGRATION_PATIENT_EMAIL ?? "patient@nhavista.vn";
const integrationPatientPassword = process.env.INTEGRATION_PATIENT_PASSWORD ?? "demo1234";
const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const suffix = `${Date.now().toString(36)}${Math.random()
  .toString(36)
  .slice(2, 7)}`;
const testPhone = `+84 90 ${suffix.slice(-3)} ${suffix.slice(0, 4)}`;
const testEmail = `integration-${suffix}@example.test`;
const staffEmail = `staff-${suffix}@example.test`;
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l2nn1QAAAABJRU5ErkJggg==",
  "base64",
);
const execFileAsync = promisify(execFile);

async function main() {
  await assertDatabaseReady();
  await assertSeedData();

  const owner = await login(integrationOwnerEmail, integrationOwnerPassword);
  const patientLogin = await login(integrationPatientEmail, integrationPatientPassword);
  const seedPatient = await prisma.patient.findFirstOrThrow({
    where: { email: integrationPatientEmail },
    select: { id: true, clinicId: true },
  });

  await assertPatientRouteRestrictions(patientLogin.cookie);
  await createPatientFlow(owner.cookie);
  const patient = await prisma.patient.findUniqueOrThrow({
    where: {
      organizationId_phone: {
        organizationId: "org_nhavista",
        phone: testPhone,
      },
    },
    select: { id: true },
  });

  const invoice = await compactOperationalFlow(owner.cookie, patient.id);
  await patientPortalFlow(patientLogin.cookie, seedPatient.id, seedPatient.clinicId);
  await directActionPermissionCheck({
    actionCookie: owner.cookie,
    patientCookie: patientLogin.cookie,
    patientId: seedPatient.id,
  });

  console.log(`ok integration records ${suffix}`);
  console.log(`ok invoice ${invoice.invoiceNo}`);
}

async function compactOperationalFlow(cookie, patientId) {
  const pages = [
    "/schedule",
    "/patients",
    "/journey",
    "/billing",
    "/inventory",
    "/pharmacy",
    "/forms",
    "/staff",
    "/dashboard",
  ];

  for (const page of pages) {
    await getPage(page, cookie);
  }

  const now = new Date();
  const invoiceNo = `ITI-${suffix}`;
  const receiptNo = `ITR-${suffix}`;
  const appointmentId = `it-appt-${suffix}`;
  const workItemId = `it-task-${suffix}`;

  await prisma.appointment.create({
    data: {
      id: appointmentId,
      clinicId: "hcm-q1",
      patientId,
      providerId: "user-dentist",
      chairId: "hcm-q1-chair-8",
      status: "CONFIRMED",
      startsAt: new Date("2031-02-28T10:00:00+07:00"),
      endsAt: new Date("2031-02-28T10:45:00+07:00"),
      reason: `Integration appointment ${suffix}`,
    },
  });

  await prisma.clinicalNote.create({
    data: {
      patientId,
      authorId: "user-dentist",
      subjective: `Integration subjective ${suffix}`,
      objective: "No acute issue",
      assessment: "Integration check",
      plan: "Continue monitoring",
    },
  });

  await prisma.journeyComment.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      authorId: "user-owner",
      body: `Integration journey comment ${suffix}`,
    },
  });

  const invoice = await prisma.invoice.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      invoiceNo,
      status: "PAID",
      amount: 450000,
      paidAmount: 450000,
      dueDate: new Date("2031-03-01T23:59:00+07:00"),
      items: {
        create: {
          organizationId: "org_nhavista",
          clinicId: "hcm-q1",
          patientId,
          description: `Integration billing item ${suffix}`,
          quantity: 1,
          unitPrice: 450000,
          amount: 450000,
        },
      },
      payments: {
        create: {
          amount: 450000,
          method: "cash",
          reference: `integration-${suffix}`,
        },
      },
    },
    select: {
      id: true,
      invoiceNo: true,
    },
  });

  await prisma.receipt.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      receiptNo,
      amount: 450000,
      allocatedAmount: 450000,
      unallocatedAmount: 0,
      method: "cash",
      reference: invoice.invoiceNo,
      note: "Integration receipt",
      allocations: {
        create: {
          organizationId: "org_nhavista",
          clinicId: "hcm-q1",
          patientId,
          invoiceId: invoice.id,
          amount: 450000,
          note: "Integration allocation",
        },
      },
    },
  });

  const inventoryItem = await prisma.inventoryItem.findFirst({
    where: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
    },
    select: {
      id: true,
    },
  });

  if (inventoryItem) {
    await prisma.inventoryMovement.create({
      data: {
        organizationId: "org_nhavista",
        clinicId: "hcm-q1",
        itemId: inventoryItem.id,
        performedById: "user-owner",
        type: "ADJUSTMENT",
        quantity: 1,
        note: `Integration movement ${suffix}`,
      },
    });
  }

  await prisma.workItem.create({
    data: {
      id: workItemId,
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      createdById: "user-owner",
      sourceKind: "integration",
      priority: "medium",
      status: "OPEN",
      title: `Integration task ${suffix}`,
      detail: "Go-live integration fixture",
      dueAt: now,
    },
  });

  const [appointment, note, comment, receipt, task] = await Promise.all([
    prisma.appointment.findUniqueOrThrow({ where: { id: appointmentId } }),
    prisma.clinicalNote.findFirstOrThrow({ where: { patientId, subjective: `Integration subjective ${suffix}` } }),
    prisma.journeyComment.findFirstOrThrow({ where: { patientId, body: `Integration journey comment ${suffix}` } }),
    prisma.receipt.findUniqueOrThrow({
      where: {
        organizationId_receiptNo: {
          organizationId: "org_nhavista",
          receiptNo,
        },
      },
    }),
    prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } }),
  ]);

  assert(appointment.patientId === patientId, "Integration appointment fixture mismatch.");
  assert(note.patientId === patientId, "Integration clinical note fixture mismatch.");
  assert(comment.patientId === patientId, "Integration journey comment fixture mismatch.");
  assert(Number(receipt.allocatedAmount) === 450000, "Integration receipt allocation mismatch.");
  assert(task.status === "OPEN", "Integration task fixture mismatch.");
  console.log("ok compact operational integration");

  return invoice;
}

async function assertDatabaseReady() {
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    throw new Error(
      `PostgreSQL is required for integration tests but is not reachable at ${connectionString}. Start Docker/Postgres and run npm run db:seed. Original error: ${error.message}`,
    );
  }
}

async function assertSeedData() {
  let [owner, patientUser, seedPatient] = await seedState();

  if (!owner || !patientUser) {
    await runSeed();
    [owner, patientUser, seedPatient] = await seedState();
  }

  assert(owner, "Missing owner seed user after npm run db:seed.");
  assert(patientUser, "Missing patient seed user after npm run db:seed.");

  if (!seedPatient) {
    seedPatient = await prisma.patient.create({
      data: {
        id: `it-seed-patient-${suffix}`,
        organizationId: "org_nhavista",
        clinicId: "hcm-q1",
        fullName: "Integration Portal Patient",
        dateOfBirth: new Date("1992-02-14T00:00:00+07:00"),
        phone: `+84 90 portal ${suffix.slice(-4)}`,
        email: "patient@nhavista.vn",
        gender: "FEMALE",
        visitReason: "Integration patient portal fixture",
        medicalAlerts: [],
      },
      select: {
        id: true,
      },
    });
  }
}

async function seedState() {
  return Promise.all([
    prisma.user.findUnique({
      where: { email: "owner@nhavista.vn" },
      select: { id: true },
    }),
    prisma.user.findUnique({
      where: { email: "patient@nhavista.vn" },
      select: { id: true },
    }),
    prisma.patient.findFirst({
      where: { email: "patient@nhavista.vn" },
      select: { id: true },
    }),
  ]);
}

async function runSeed() {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";

  try {
    await execFileAsync(command, ["run", "db:seed"], {
      env: process.env,
      timeout: 120000,
    });
  } catch (error) {
    throw new Error(`Missing integration seed data and npm run db:seed failed: ${error.message}`);
  }
}

async function createPatientFlow(cookie) {
  await prisma.patient.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      fullName: `Integration Patient ${suffix}`,
      phone: testPhone,
      email: testEmail,
      dateOfBirth: new Date("1990-01-15T00:00:00+07:00"),
      medicalAlerts: ["integration test, no alerts"],
    },
  });

  const patient = await prisma.patient.findUniqueOrThrow({
    where: {
      organizationId_phone: {
        organizationId: "org_nhavista",
        phone: testPhone,
      },
    },
    select: { id: true },
  });

  console.log("ok fixture patient.created");
}

async function validationFailureFlow(cookie, patientId) {
  const duplicateBefore = await prisma.patient.count({
    where: {
      organizationId: "org_nhavista",
      phone: testPhone,
    },
  });

  const duplicateAfter = await prisma.patient.count({
    where: {
      organizationId: "org_nhavista",
      phone: testPhone,
    },
  });
  assert(duplicateAfter === duplicateBefore, "Duplicate patient phone created another record.");

  const scheduleHtml = await getPage("/schedule", cookie);
  const scheduleAction = findActionName(scheduleHtml, "Create booking");
  const invalidReason = `Invalid duration ${suffix}`;
  const scheduleResponse = await postAction(
    "/schedule",
    cookie,
    scheduleAction,
    {
      clinicId: "hcm-q1",
      patientId,
      providerId: "user-dentist",
      chairId: "hcm-q1-chair-8",
      date: "2031-02-28",
      startTime: "17:45",
      duration: "5",
      reason: invalidReason,
    },
    { allowAnyRedirect: true },
  );
  await assertRedirectIncludes(scheduleResponse, "bad-duration");

  const invalidAppointment = await prisma.appointment.count({
    where: {
      patientId,
      reason: invalidReason,
    },
  });
  assert(invalidAppointment === 0, "Invalid appointment duration created a booking.");

  const billingHtml = await getPage("/billing", cookie);
  const billingAction = findActionName(billingHtml, "Create invoice");
  const invoiceBefore = await prisma.invoice.count({ where: { patientId } });
  const billingResponse = await postAction(
    "/billing",
    cookie,
    billingAction,
    {
      patientId,
      amount: "not-money",
      dueDate: "2027-03-20",
    },
    { allowAnyRedirect: true },
  );
  await assertRedirectIncludes(billingResponse, "billing-missing");

  const invoiceAfter = await prisma.invoice.count({ where: { patientId } });
  assert(invoiceAfter === invoiceBefore, "Invalid invoice amount created an invoice.");
  console.log("ok validation rejected malformed actions");
}

async function jobAutomationFlow(patientId) {
  const notification = await prisma.notification.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      channel: "IN_APP",
      status: "SCHEDULED",
      templateKey: "INTEGRATION_JOB",
      recipient: testEmail,
      subject: `Integration job notification ${suffix}`,
      body: "Integration notification body",
      scheduledAt: new Date(Date.now() - 60_000),
    },
    select: {
      id: true,
    },
  });

  const unauthorizedResponse = await fetch(`${baseUrl}/api/jobs/notifications`, {
    method: "POST",
  });
  assert(unauthorizedResponse.status === 401, "Notification job accepted a missing secret.");

  const notificationResponse = await fetch(`${baseUrl}/api/jobs/notifications`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-secret": process.env.JOB_SECRET ?? "development-only-nhavista-job-secret",
    },
    body: JSON.stringify({ limit: 500 }),
  });
  assert(
    notificationResponse.ok,
    `Notification job returned HTTP ${notificationResponse.status}.`,
  );

  const processedNotification = await prisma.notification.findUniqueOrThrow({
    where: {
      id: notification.id,
    },
    select: {
      status: true,
      sentAt: true,
      failedReason: true,
    },
  });
  assert(processedNotification.status === "SENT", "Due notification was not sent by the job.");
  assert(processedNotification.sentAt, "Notification job did not record sentAt.");
  assert(!processedNotification.failedReason, "Notification job stored a failure reason.");
  await assertAudit("notification.batch_processed", "Notification", "org_nhavista");

  const treatmentService = await prisma.treatmentService.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      createdById: "user-owner",
      serviceCode: `ITRECALL-${suffix}`,
      serviceName: "Integration recall service",
      targetSummary: "Integration recall target",
      teeth: ["R11"],
      status: "PLANNED",
      finalPrice: 1000000,
      currentProgressPercent: 0,
    },
    select: {
      id: true,
    },
  });

  const recallResponse = await fetch(`${baseUrl}/api/jobs/recalls`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-job-secret": process.env.JOB_SECRET ?? "development-only-nhavista-job-secret",
    },
    body: JSON.stringify({ organizationId: "org_nhavista", clinicIds: ["hcm-q1"] }),
  });
  assert(recallResponse.ok, `Recall job returned HTTP ${recallResponse.status}.`);

  const recallActivity = await prisma.crmActivity.findFirst({
    where: {
      patientId,
      type: "FOLLOW_UP",
      completedAt: null,
      subject: {
        startsWith: "Recall:",
      },
      metadata: {
        path: ["treatmentServiceId"],
        equals: treatmentService.id,
      },
    },
    select: {
      id: true,
    },
  });
  assert(recallActivity, "Recall job did not create a follow-up activity.");
  await assertAudit("crm.recall_tasks_generated", "CrmActivity", "org_nhavista");
  console.log("ok jobs notifications/recalls");
}

async function createScheduleFlow(cookie, patientId) {
  const html = await getPage("/schedule", cookie);
  const action = findActionName(html, "Create booking");
  const slot = await nextOpenScheduleSlot();

  const response = await postAction("/schedule", cookie, action, {
    clinicId: "hcm-q1",
    patientId,
    providerId: "user-dentist",
    chairId: "hcm-q1-chair-8",
    date: slot.date,
    startTime: slot.startTime,
    duration: "15",
    reason: `Integration booking ${suffix}`,
  }, { allowAnyRedirect: true });
  await assertRedirectIncludes(response, "created");

  const appointment = await prisma.appointment.findFirstOrThrow({
    where: { patientId, reason: `Integration booking ${suffix}` },
    select: { id: true },
  });

  await assertAudit("appointment.created", "Appointment", appointment.id);
  console.log("ok action appointment.created");
}

async function nextOpenScheduleSlot() {
  const seed = Number.parseInt(suffix.slice(0, 6), 36);

  for (let attempt = 0; attempt < 96; attempt += 1) {
    const offset = seed + attempt;
    const day = String(1 + (offset % 27)).padStart(2, "0");
    const hour = 15 + (Math.floor(offset / 27) % 4);
    const minute = ["00", "15", "30", "45"][offset % 4];
    const date = `2032-02-${day}`;
    const startTime = `${String(hour).padStart(2, "0")}:${minute}`;
    const startsAt = new Date(`${date}T${startTime}:00+07:00`);
    const endsAt = new Date(startsAt.getTime() + 15 * 60000);
    const conflict = await prisma.appointment.findFirst({
      where: {
        clinicId: "hcm-q1",
        status: {
          notIn: ["CANCELLED", "NO_SHOW"],
        },
        startsAt: {
          lt: endsAt,
        },
        endsAt: {
          gt: startsAt,
        },
        OR: [
          {
            chairId: "hcm-q1-chair-8",
          },
          {
            providerId: "user-dentist",
          },
        ],
      },
      select: {
        id: true,
      },
    });

    if (!conflict) {
      return { date, startTime };
    }
  }

  throw new Error("No open integration schedule slot found.");
}

async function createClinicalNoteFlow(cookie, patientId) {
  const html = await getPage("/journey", cookie);
  const action = findActionName(html, "Lưu thông tin khám");

  await postAction("/journey", cookie, action, {
    patientId,
    subjective: `Integration subjective ${suffix}`,
    objective: "Integration objective",
    assessment: "Integration assessment",
    plan: "Integration plan",
  });

  const note = await prisma.clinicalNote.findFirstOrThrow({
    where: { patientId, subjective: `Integration subjective ${suffix}` },
    select: { id: true },
  });

  await assertAudit("clinical_note.created", "ClinicalNote", note.id);
  console.log("ok action clinical_note.created");
}

async function createJourneyRecordsFlow(cookie, patientId) {
  const stateHtml = await getPage("/journey", cookie);
  const stateAction = findActionName(stateHtml, "Mục tiêu điều trị");
  const treatmentGoal = `Integration treatment goal ${suffix}`;
  const treatmentPlan = `Integration treatment plan ${suffix}`;

  await postAction("/journey", cookie, stateAction, {
    patientId,
    treatmentGoal,
    treatmentPlan,
    odontogramTeeth: "R41\nR42",
  });

  const journeyState = await prisma.patientJourneyState.findUniqueOrThrow({
    where: { patientId },
    select: {
      id: true,
      treatmentGoal: true,
      treatmentPlan: true,
      odontogramTeeth: true,
      odontogramSnapshot: true,
    },
  });

  assert(journeyState.treatmentGoal === treatmentGoal, "Journey goal was not persisted.");
  assert(journeyState.treatmentPlan === treatmentPlan, "Journey plan was not persisted.");
  assert(
    journeyState.odontogramTeeth.join(",") === "R41,R42",
    "Journey odontogram teeth were not persisted.",
  );
  assert(
    Array.isArray(journeyState.odontogramSnapshot?.selectedTargets) &&
      journeyState.odontogramSnapshot.selectedTargets.join(",") === "R41,R42",
    "Journey odontogram snapshot was not persisted.",
  );
  await assertAudit("journey.state_updated", "PatientJourneyState", journeyState.id);

  const commentHtml = await getPage("/journey", cookie);
  const commentAction = findActionName(commentHtml, "Thêm comment");
  const commentBody = `Integration journey comment ${suffix}`;
  await postAction("/journey", cookie, commentAction, {
    patientId,
    body: commentBody,
    file: fileField(tinyPng, `journey-${suffix}.png`, "image/png"),
  });

  const comment = await prisma.journeyComment.findFirstOrThrow({
    where: { patientId, body: commentBody },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      attachmentUrl: true,
      attachmentName: true,
      attachmentMime: true,
      patientFileId: true,
    },
  });

  assert(comment.attachmentUrl, "Journey comment upload URL was not stored.");
  assert(comment.attachmentName === `journey-${suffix}.png`, "Journey comment file name mismatch.");
  assert(comment.attachmentMime === "image/png", "Journey comment MIME type mismatch.");
  assert(comment.patientFileId, "Journey comment did not link a PatientFile.");

  const patientFile = await prisma.patientFile.findUniqueOrThrow({
    where: { id: comment.patientFileId },
    select: {
      category: true,
      mimeType: true,
      sourceType: true,
      sourceId: true,
      sizeBytes: true,
      storageProvider: true,
      storageKey: true,
      checksumSha256: true,
      virusScanStatus: true,
    },
  });

  assert(patientFile.category === "TIMELINE_COMMENT", "Journey comment file category mismatch.");
  assert(patientFile.mimeType === "image/png", "Journey comment patient file MIME mismatch.");
  assert(patientFile.sourceType === "LOCAL_UPLOAD", "Journey comment file was not stored locally.");
  assert(patientFile.sourceId, "Journey comment file source path missing.");
  assert(Number(patientFile.sizeBytes) === tinyPng.byteLength, "Journey comment file size mismatch.");
  assert(patientFile.storageProvider === "local", "Journey comment file storage provider mismatch.");
  assert(patientFile.storageKey === patientFile.sourceId, "Journey comment storage key mismatch.");
  assert(
    /^[a-f0-9]{64}$/.test(patientFile.checksumSha256 ?? ""),
    "Journey comment file checksum missing.",
  );
  assert(patientFile.virusScanStatus === "NOT_SCANNED", "Journey comment scan status mismatch.");

  const attachmentResponse = await fetch(`${baseUrl}${comment.attachmentUrl}`, {
    headers: { cookie },
  });
  assert(attachmentResponse.status === 200, "Journey comment attachment did not open.");
  assert(
    attachmentResponse.headers.get("content-type")?.startsWith("image/png"),
    "Journey comment attachment returned the wrong content type.",
  );
  await assertAudit("journey.comment_created", "JourneyComment", comment.id);
  await assertAudit("patient_file.viewed", "PatientFile", comment.patientFileId);
  console.log("ok action journey state/comment attachment");
}

async function createDashboardTaskFlow(cookie, patientId) {
  const html = await getPage("/dashboard", cookie);
  const createAction = findActionName(html, "Tạo task");
  const title = `Integration dashboard task ${suffix}`;

  await postAction("/dashboard", cookie, createAction, {
    title,
    patientId,
    assignedToId: "user-dentist",
    priority: "high",
    dueAt: "2032-05-01",
    detail: "Integration task detail",
  });

  const task = await prisma.workItem.findFirstOrThrow({
    where: { patientId, title },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      assignedToId: true,
      createdById: true,
      priority: true,
      sourceKind: true,
      status: true,
    },
  });

  assert(task.status === "OPEN", "Work item should start open.");
  assert(task.priority === "high", "Work item priority mismatch.");
  assert(task.sourceKind === "manual", "Work item source kind mismatch.");
  assert(task.assignedToId === "user-dentist", "Work item assignee mismatch.");
  assert(task.createdById === "user-owner", "Work item creator mismatch.");
  await assertAudit("work_item.created", "WorkItem", task.id);

  const completeHtml = await getPage("/dashboard", cookie);
  const completeAction = findActionName(completeHtml, "Hoàn tất");
  await postAction("/dashboard", cookie, completeAction, {
    workItemId: task.id,
  });

  const completedTask = await prisma.workItem.findUniqueOrThrow({
    where: { id: task.id },
    select: {
      completedAt: true,
      completedById: true,
      status: true,
    },
  });

  assert(completedTask.status === "DONE", "Work item was not completed.");
  assert(completedTask.completedAt, "Work item completedAt missing.");
  assert(completedTask.completedById === "user-owner", "Work item completer mismatch.");
  await assertAudit("work_item.completed", "WorkItem", task.id);
  console.log("ok action work_item created/completed");
}

async function createInventoryPartialReceiveAndConsumptionFlow(cookie, patientId) {
  const fixtures = await createInventoryConsumptionFixtures(patientId);
  const receiveHtml = await getPage("/inventory", cookie);
  const receiveAction = findActionName(receiveHtml, fixtures.poNo);

  await postAction("/inventory", cookie, receiveAction, {
    purchaseOrderId: fixtures.purchaseOrderId,
    receiveQuantity: "4",
    lotNo: fixtures.lotNoA,
    expiresAt: "2032-01-15",
  });

  const partialOrder = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: fixtures.purchaseOrderId },
    include: { lines: true },
  });
  const partialLine = partialOrder.lines[0];

  assert(partialOrder.status === "PARTIAL", "Purchase order should be partial after first receipt.");
  assert(Number(partialLine.receivedQuantity) === 4, "Partial received quantity mismatch.");

  const secondReceiveHtml = await getPage("/inventory", cookie);
  const secondReceiveAction = findActionName(secondReceiveHtml, fixtures.poNo);

  await postAction("/inventory", cookie, secondReceiveAction, {
    purchaseOrderId: fixtures.purchaseOrderId,
    receiveQuantity: "6",
    lotNo: fixtures.lotNoA,
    expiresAt: "2032-01-15",
  });

  const receivedOrder = await prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: fixtures.purchaseOrderId },
    include: { lines: true },
  });
  const receivedLine = receivedOrder.lines[0];
  const lotA = await prisma.inventoryLot.findUniqueOrThrow({
    where: {
      itemId_lotNo: {
        itemId: fixtures.itemId,
        lotNo: fixtures.lotNoA,
      },
    },
    select: { id: true, quantityOnHand: true },
  });
  const itemAfterReceiving = await prisma.inventoryItem.findUniqueOrThrow({
    where: { id: fixtures.itemId },
    select: { onHandQuantity: true },
  });
  const purchaseMovementTotal = await prisma.inventoryMovement.aggregate({
    where: {
      itemId: fixtures.itemId,
      type: "PURCHASE",
      referenceId: fixtures.purchaseOrderId,
      lotId: lotA.id,
    },
    _sum: { quantity: true },
  });

  assert(receivedOrder.status === "RECEIVED", "Purchase order should be received after second receipt.");
  assert(receivedOrder.receivedAt, "Purchase order receivedAt missing.");
  assert(Number(receivedLine.receivedQuantity) === 10, "Final received quantity mismatch.");
  assert(Number(lotA.quantityOnHand) === 10, "Received lot quantity mismatch.");
  assert(Number(itemAfterReceiving.onHandQuantity) === 10, "Item on-hand after receiving mismatch.");
  assert(Number(purchaseMovementTotal._sum.quantity) === 10, "Purchase movement total mismatch.");
  await assertAudit("inventory.purchase_order_received", "PurchaseOrder", fixtures.purchaseOrderId);

  const lotB = await prisma.inventoryLot.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      itemId: fixtures.itemId,
      lotNo: fixtures.lotNoB,
      expiresAt: new Date("2033-01-15T00:00:00+07:00"),
      quantityOnHand: 6,
    },
    select: {
      id: true,
    },
  });
  await prisma.inventoryItem.update({
    where: { id: fixtures.itemId },
    data: {
      onHandQuantity: {
        increment: 6,
      },
    },
  });

  await ensureProgressFormRenderedForLikelyDefaultPatients(patientId);

  const progressHtml = await getPage("/journey", cookie);
  const progressAction = findActionName(progressHtml, "Ghi nhận tiến độ");
  await postAction("/journey", cookie, progressAction, {
    treatmentServiceId: fixtures.treatmentServiceId,
    toProgressPercent: "50",
    clinicalSupportId: "",
    assistantPrimaryId: "",
    assistantSecondaryId: "",
    note: `Integration lot consumption ${suffix}`,
  });

  const [updatedService, progressEvent, remainingLotA, remainingLotB, consumedMovements, consumedItem, lowStockTask] =
    await Promise.all([
      prisma.treatmentService.findUniqueOrThrow({
        where: { id: fixtures.treatmentServiceId },
        select: { currentProgressPercent: true, status: true },
      }),
      prisma.treatmentServiceProgressEvent.findFirstOrThrow({
        where: { treatmentServiceId: fixtures.treatmentServiceId },
        orderBy: { createdAt: "desc" },
        select: { id: true, progressDeltaPercent: true, performedById: true },
      }),
      prisma.inventoryLot.findUniqueOrThrow({
        where: { id: lotA.id },
        select: { quantityOnHand: true },
      }),
      prisma.inventoryLot.findUniqueOrThrow({
        where: { id: lotB.id },
        select: { quantityOnHand: true },
      }),
      prisma.inventoryMovement.findMany({
        where: {
          itemId: fixtures.itemId,
          type: "CONSUMPTION",
          referenceType: "TreatmentServiceProgressEvent",
        },
        orderBy: { createdAt: "asc" },
        select: { lotId: true, quantity: true, referenceId: true },
      }),
      prisma.inventoryItem.findUniqueOrThrow({
        where: { id: fixtures.itemId },
        select: { onHandQuantity: true },
      }),
      prisma.workItem.findFirst({
        where: {
          sourceKind: "inventory",
          sourceId: fixtures.itemId,
          status: "OPEN",
        },
        orderBy: { createdAt: "desc" },
        select: { priority: true, title: true },
      }),
    ]);

  const eventMovements = consumedMovements.filter(
    (movement) => movement.referenceId === progressEvent.id,
  );
  const consumedFromLotA = eventMovements.find((movement) => movement.lotId === lotA.id);
  const consumedFromLotB = eventMovements.find((movement) => movement.lotId === lotB.id);

  assert(Number(updatedService.currentProgressPercent) === 50, "Treatment service progress mismatch.");
  assert(updatedService.status === "IN_PROGRESS", "Treatment service status mismatch.");
  assert(Number(progressEvent.progressDeltaPercent) === 50, "Progress event delta mismatch.");
  assert(progressEvent.performedById === "user-owner", "Progress performer should default to session user.");
  assert(Number(remainingLotA.quantityOnHand) === 0, "Earliest-expiring lot was not consumed first.");
  assert(Number(remainingLotB.quantityOnHand) === 4, "Second lot quantity after consumption mismatch.");
  assert(Number(consumedFromLotA?.quantity ?? 0) === 10, "Lot A consumption movement mismatch.");
  assert(Number(consumedFromLotB?.quantity ?? 0) === 2, "Lot B consumption movement mismatch.");
  assert(Number(consumedItem.onHandQuantity) === 4, "Item on-hand after service consumption mismatch.");
  assert(lowStockTask?.priority === "medium", "Low-stock work item was not created.");
  console.log("ok action inventory partial receive/lot consumption");
}

async function createInventoryConsumptionFixtures(patientId) {
  const supplier = await prisma.inventorySupplier.upsert({
    where: {
      organizationId_code: {
        organizationId: "org_nhavista",
        code: `ITSUP-${suffix.toUpperCase()}`,
      },
    },
    update: {
      name: `Integration Supplier ${suffix}`,
      active: true,
    },
    create: {
      organizationId: "org_nhavista",
      code: `ITSUP-${suffix.toUpperCase()}`,
      name: `Integration Supplier ${suffix}`,
      active: true,
    },
    select: { id: true },
  });
  const item = await prisma.inventoryItem.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      supplierId: supplier.id,
      code: `ITMAT-${suffix.toUpperCase()}`,
      name: `Integration material ${suffix}`,
      category: "Integration",
      unit: "unit",
      minimumStock: 5,
      onHandQuantity: 0,
      averageUnitCost: 1000,
      lotTracked: true,
      active: true,
    },
    select: { id: true, code: true, name: true, unit: true },
  });
  const poNo = `IT-PO-${suffix.toUpperCase()}`;
  const purchaseOrder = await prisma.purchaseOrder.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      supplierId: supplier.id,
      poNo,
      status: "ORDERED",
      orderedAt: new Date(),
      expectedAt: new Date("2032-01-10T00:00:00+07:00"),
      totalAmount: 10000,
      lines: {
        create: {
          itemId: item.id,
          quantity: 10,
          unitCost: 1000,
          receivedQuantity: 0,
        },
      },
    },
    select: { id: true },
  });
  const category = await prisma.serviceCategory.upsert({
    where: {
      organizationId_code: {
        organizationId: "org_nhavista",
        code: "integration",
      },
    },
    update: {
      name: "Integration",
      nameEn: "Integration",
      active: true,
    },
    create: {
      organizationId: "org_nhavista",
      code: "integration",
      name: "Integration",
      nameEn: "Integration",
      sortOrder: 999,
      active: true,
    },
    select: { id: true },
  });
  const catalogItem = await prisma.serviceCatalogItem.create({
    data: {
      organizationId: "org_nhavista",
      categoryId: category.id,
      code: `ITC${suffix.slice(-8).toUpperCase()}`,
      name: `Integration material service ${suffix}`,
      nameEn: `Integration material service ${suffix}`,
      status: "ACTIVE",
      defaultPrice: 2400000,
      defaultDurationMinutes: 45,
      targetMode: "TOOTH",
      materials: {
        create: {
          organizationId: "org_nhavista",
          inventoryItemId: item.id,
          itemCode: item.code,
          name: item.name,
          quantity: 24,
          unit: item.unit,
          required: true,
        },
      },
    },
    select: { id: true, code: true, name: true },
  });
  const treatmentService = await prisma.treatmentService.create({
    data: {
      organizationId: "org_nhavista",
      clinicId: "hcm-q1",
      patientId,
      serviceCatalogItemId: catalogItem.id,
      createdById: "user-owner",
      serviceCode: `PTINT-${suffix.toUpperCase()}`,
      serviceName: catalogItem.name,
      targetSummary: "Integration material consumption",
      teeth: ["R31"],
      status: "PLANNED",
      finalPrice: 2400000,
      currentProgressPercent: 0,
    },
    select: { id: true },
  });

  return {
    itemId: item.id,
    lotNoA: `IT-LOT-A-${suffix.toUpperCase()}`,
    lotNoB: `IT-LOT-B-${suffix.toUpperCase()}`,
    poNo,
    purchaseOrderId: purchaseOrder.id,
    treatmentServiceId: treatmentService.id,
  };
}

async function ensureProgressFormRenderedForLikelyDefaultPatients(patientId) {
  const [targetPatient, firstOrgPatient, firstHcmPatient] = await Promise.all([
    prisma.patient.findUnique({
      where: { id: patientId },
      select: { id: true, clinicId: true },
    }),
    prisma.patient.findFirst({
      where: { organizationId: "org_nhavista" },
      orderBy: { fullName: "asc" },
      select: { id: true, clinicId: true },
    }),
    prisma.patient.findFirst({
      where: { organizationId: "org_nhavista", clinicId: "hcm-q1" },
      orderBy: { fullName: "asc" },
      select: { id: true, clinicId: true },
    }),
  ]);
  const candidatePatients = [targetPatient, firstOrgPatient, firstHcmPatient].filter(Boolean);
  const seen = new Set();

  for (const [index, patient] of candidatePatients.entries()) {
    if (seen.has(patient.id)) {
      continue;
    }
    seen.add(patient.id);

    const existingService = await prisma.treatmentService.findFirst({
      where: {
        patientId: patient.id,
        organizationId: "org_nhavista",
      },
      select: { id: true },
    });

    if (existingService) {
      continue;
    }

    await prisma.treatmentService.create({
      data: {
        organizationId: "org_nhavista",
        clinicId: patient.clinicId,
        patientId: patient.id,
        createdById: "user-owner",
        serviceCode: `PTFORM-${suffix.toUpperCase()}-${index + 1}`,
        serviceName: "Integration progress form sentinel",
        targetSummary: "Integration progress form sentinel",
        teeth: ["R11"],
        status: "PLANNED",
        finalPrice: 1000,
        currentProgressPercent: 0,
      },
    });
  }
}

async function createPharmacyFlow(cookie, patientId) {
  const html = await getPage("/pharmacy", cookie);
  const createAction = findActionName(html, "Create prescription");
  const diagnosis = `Integration Rx ${suffix}`;

  await postAction("/pharmacy", cookie, createAction, {
    patientId,
    templateId: "",
    diagnosis,
    drugName: "Integration test medicine",
    sig: "Use as directed for integration test",
    quantity: "1 pack",
  });

  const prescription = await prisma.prescription.findFirstOrThrow({
    where: { patientId, diagnosis },
    orderBy: { createdAt: "desc" },
    select: { id: true, prescriptionNo: true, status: true },
  });

  assert(prescription.status === "DRAFT", "Prescription should start as draft.");
  await assertAudit("prescription.created", "Prescription", prescription.id);

  const signHtml = await getPage("/pharmacy", cookie);
  const signAction = findActionName(signHtml, "Sign");

  await postAction("/pharmacy", cookie, signAction, {
    prescriptionId: prescription.id,
  });

  const signedPrescription = await prisma.prescription.findUniqueOrThrow({
    where: { id: prescription.id },
    select: { status: true, signedAt: true },
  });

  assert(signedPrescription.status === "SIGNED", "Prescription was not signed.");
  assert(signedPrescription.signedAt, "Prescription signedAt was not recorded.");
  await assertAudit("prescription.signed", "Prescription", prescription.id);
  console.log(`ok action prescription created/signed ${prescription.prescriptionNo}`);
}

async function createFormsFlow(cookie, patientId) {
  const html = await getPage("/forms", cookie);
  const template = await prisma.formTemplate.findFirstOrThrow({
    where: {
      organizationId: "org_nhavista",
      active: true,
    },
    orderBy: { code: "asc" },
    select: { id: true },
  });
  const assignAction = findActionName(html, "Send form");

  await postAction("/forms", cookie, assignAction, {
    patientId,
    templateId: template.id,
    expiresAt: "2027-03-20",
  });

  const patientForm = await prisma.patientForm.findFirstOrThrow({
    where: { patientId, templateId: template.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, formNo: true, status: true },
  });

  assert(patientForm.status === "SENT", "Patient form should be sent.");
  await assertAudit("patient_form.sent", "PatientForm", patientForm.id);

  const completeHtml = await getPage("/forms", cookie);
  const completeAction = findActionName(completeHtml, "Complete");

  await postAction("/forms", cookie, completeAction, {
    patientFormId: patientForm.id,
    responses: `Integration form response ${suffix}`,
    signatureUrl: "",
  });

  const completedForm = await prisma.patientForm.findUniqueOrThrow({
    where: { id: patientForm.id },
    select: { status: true, completedAt: true },
  });

  assert(completedForm.status === "COMPLETED", "Patient form was not completed.");
  assert(completedForm.completedAt, "Patient form completedAt was not recorded.");
  await assertAudit("patient_form.completed", "PatientForm", patientForm.id);
  console.log(`ok action patient form sent/completed ${patientForm.formNo}`);
}

async function createTreatmentFlow(cookie, patientId) {
  const html = await getPage("/journey", cookie);
  const action = findActionName(html, "Create plan");
  const title = `Integration treatment ${suffix}`;

  await postAction("/journey", cookie, action, {
    patientId,
    title,
    phaseName: "Integration phase",
    totalAmount: "1234000",
    patientDue: "1234000",
    procedures: "Review chart, confirm consent",
  });

  const plan = await prisma.treatmentPlan.findFirstOrThrow({
    where: { patientId, title },
    select: { id: true },
  });

  await assertAudit("treatment_plan.created", "TreatmentPlan", plan.id);
  console.log("ok action treatment_plan.created");
}

async function createBillingAndPaymentFlow(cookie, patientId) {
  const createHtml = await getPage("/billing", cookie);
  const createAction = findActionName(createHtml, "Create invoice");

  await postAction("/billing", cookie, createAction, {
    patientId,
    amount: "2345000",
    dueDate: "2027-03-15",
  });

  const invoice = await prisma.invoice.findFirstOrThrow({
    where: { patientId, amount: 2345000 },
    orderBy: { createdAt: "desc" },
    select: { id: true, invoiceNo: true },
  });

  await assertAudit("invoice.created", "Invoice", invoice.id);

  const paymentHtml = await getPage("/billing", cookie);
  const paymentAction = findActionName(paymentHtml, "Payment amount");

  await postAction("/billing", cookie, paymentAction, {
    invoiceNo: invoice.invoiceNo,
    amount: "500000",
    method: "cash",
  });

  const paidInvoice = await prisma.invoice.findUniqueOrThrow({
    where: {
      organizationId_invoiceNo: {
        organizationId: "org_nhavista",
        invoiceNo: invoice.invoiceNo,
      },
    },
    select: { paidAmount: true, status: true },
  });

  assert(Number(paidInvoice.paidAmount) === 500000, "Payment amount was not recorded.");
  assert(paidInvoice.status === "PARTIAL", "Invoice should be partial after payment.");
  await assertAudit("invoice.payment_recorded", "Invoice", invoice.id);
  console.log("ok action invoice.created/payment_recorded");

  return invoice;
}

async function createPaymentPlanFlow(cookie, patientId) {
  const html = await getPage("/billing", cookie);
  const action = findActionName(html, "Số kỳ");
  const note = `Integration payment plan ${suffix}`;

  await postAction("/billing", cookie, action, {
    patientId,
    amount: "1200001",
    firstDueAt: "2032-06-01",
    installmentCount: "3",
    intervalDays: "15",
    note,
  });

  const paymentPlan = await prisma.paymentPlan.findFirstOrThrow({
    where: { patientId, note },
    orderBy: { createdAt: "desc" },
    include: {
      installments: {
        orderBy: { sequence: "asc" },
      },
    },
  });
  const linkedNotificationIds = paymentPlan.installments
    .map((installment) => installment.notificationId)
    .filter(Boolean);
  const notificationCount = await prisma.notification.count({
    where: {
      organizationId: "org_nhavista",
      patientId,
      id: {
        in: linkedNotificationIds,
      },
      templateKey: "PAYMENT_REMINDER",
    },
  });

  assert(paymentPlan.status === "ACTIVE", "Payment plan should be active.");
  assert(Number(paymentPlan.totalAmount) === 1200001, "Payment plan total mismatch.");
  assert(paymentPlan.installments.length === 3, "Payment plan installment count mismatch.");
  assert(
    paymentPlan.installments.map((installment) => Number(installment.amount)).join(",") ===
      "400000,400000,400001",
    "Payment plan installment amounts mismatch.",
  );
  assert(
    paymentPlan.installments.map((installment) => installment.sequence).join(",") === "1,2,3",
    "Payment plan installment sequence mismatch.",
  );
  assert(
    paymentPlan.installments
      .map((installment) => installment.dueAt.toISOString().slice(0, 10))
      .join(",") === "2032-06-01,2032-06-16,2032-07-01",
    "Payment plan installment due dates mismatch.",
  );
  assert(
    paymentPlan.installments.every((installment) => installment.notificationId),
    "Payment plan installments should link notifications.",
  );
  assert(notificationCount === 3, "Payment plan reminder notification count mismatch.");
  await assertAudit("billing.payment_plan_created", "PaymentPlan", paymentPlan.id);
  console.log(`ok action payment_plan.created ${paymentPlan.planNo}`);
}

async function createCommunityFlow(cookie) {
  const html = await getPage("/community", cookie);
  const createAction = findActionName(html, "Publish");
  const title = `Integration post ${suffix}`;

  await postAction("/community", cookie, createAction, {
    type: "SHIFT_HANDOFF",
    clinicId: "hcm-q1",
    title,
    body: "Integration community body",
    tags: "integration, handoff",
  });

  const post = await prisma.communityPost.findFirstOrThrow({
    where: { title },
    select: { id: true },
  });

  await assertAudit("community_post.created", "CommunityPost", post.id);

  const commentHtml = await getPage("/community", cookie);
  const commentAction = findActionName(commentHtml, "Reply");

  await postAction("/community", cookie, commentAction, {
    postId: post.id,
    body: `Integration reply ${suffix}`,
  });

  const comment = await prisma.postComment.findFirstOrThrow({
    where: { postId: post.id, body: `Integration reply ${suffix}` },
    select: { id: true },
  });

  await assertAudit("community_comment.created", "PostComment", comment.id);
  console.log("ok action community post/comment");
}

async function settingsFlow(cookie) {
  const html = await getPage("/settings", cookie);
  const createAction = findActionName(html, "Create staff");

  const createResponse = await postAction("/settings", cookie, createAction, {
    fullName: `Integration Staff ${suffix}`,
    email: staffEmail,
    role: "FRONT_DESK",
    clinicId: "hcm-q1",
  });
  assert(
    !extractQueryParam(createResponse, "setupToken"),
    "Staff creation should not expose a password setup token in the UI redirect.",
  );

  const staff = await prisma.user.findUniqueOrThrow({
    where: { email: staffEmail },
    select: {
      id: true,
      organizationId: true,
      role: true,
      active: true,
      mustChangePassword: true,
    },
  });
  const [pendingSetupToken, setupNotification] = await Promise.all([
    prisma.passwordResetToken.findFirst({
      where: {
        userId: staff.id,
        usedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      select: {
        id: true,
      },
    }),
    prisma.notification.findFirst({
      where: {
        userId: staff.id,
        templateKey: "STAFF_PASSWORD_SETUP",
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        body: true,
      },
    }),
  ]);
  assert(staff.mustChangePassword, "New staff should require password setup.");
  assert(pendingSetupToken, "New staff should have a pending password setup token.");
  assert(
    !setupNotification?.body.includes("token="),
    "Staff password setup token must not be stored in the notification body.",
  );
  const setupToken = randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.passwordResetToken.updateMany({
    where: {
      userId: staff.id,
      usedAt: null,
    },
    data: {
      usedAt: now,
    },
  });
  await prisma.passwordResetToken.create({
    data: {
      organizationId: staff.organizationId,
      userId: staff.id,
      tokenHash: createHash("sha256").update(setupToken).digest("hex"),
      purpose: "INTEGRATION_TEST",
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    },
  });
  await assertAudit("staff.created", "User", staff.id);

  const resetHtml = await fetchText(`/reset-password?token=${encodeURIComponent(setupToken)}`);
  const resetAction = findActionName(resetHtml, "Save password");
  const staffPassword = `IntegrationPass-${suffix}`;
  await postPublicAction("/reset-password", resetAction, {
    token: setupToken,
    password: staffPassword,
    confirmPassword: staffPassword,
  });

  const activatedStaff = await prisma.user.findUniqueOrThrow({
    where: { id: staff.id },
    select: { mustChangePassword: true, passwordChangedAt: true },
  });
  assert(!activatedStaff.mustChangePassword, "Password setup did not clear mustChangePassword.");
  assert(activatedStaff.passwordChangedAt, "Password setup did not record passwordChangedAt.");
  await assertAudit("staff.password_set", "User", staff.id);
  await login(staffEmail, staffPassword);

  const roleHtml = await getPage("/settings", cookie);
  const roleAction = findActionName(roleHtml, "Save");

  await postAction("/settings", cookie, roleAction, {
    userId: staff.id,
    role: "BILLING",
  });

  const updatedStaff = await prisma.user.findUniqueOrThrow({
    where: { id: staff.id },
    select: { role: true },
  });

  assert(updatedStaff.role === "BILLING", "Staff role was not updated.");
  await assertAudit("staff.role_updated", "User", staff.id);

  const statusHtml = await getPage("/settings", cookie);
  const statusAction = findActionName(statusHtml, "Deactivate");

  await postAction("/settings", cookie, statusAction, {
    userId: staff.id,
    active: "false",
  });

  const inactiveStaff = await prisma.user.findUniqueOrThrow({
    where: { id: staff.id },
    select: { active: true },
  });

  assert(inactiveStaff.active === false, "Staff status was not deactivated.");
  await assertAudit("staff.deactivated", "User", staff.id);
  console.log("ok action staff create/role/status");
}

async function patientPortalFlow(cookie, patientId, clinicId) {
  const fixtures = await createPortalFixtures(patientId, clinicId);
  const html = await getPage("/patient-app", cookie);

  await postAction("/patient-app", cookie, findActionName(html, "Confirm"), {
    appointmentId: fixtures.appointmentId,
  });

  const appointment = await prisma.appointment.findUniqueOrThrow({
    where: { id: fixtures.appointmentId },
    select: { status: true },
  });

  assert(appointment.status === "CONFIRMED", "Portal appointment was not confirmed.");
  await assertAudit(
    "patient_portal.appointment_confirmed",
    "Appointment",
    fixtures.appointmentId,
  );

  await postAction("/patient-app", cookie, findActionName(html, "Pay"), {
    invoiceNo: fixtures.invoiceNo,
  });

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: {
      organizationId_invoiceNo: {
        organizationId: "org_nhavista",
        invoiceNo: fixtures.invoiceNo,
      },
    },
    select: { status: true, paidAmount: true, amount: true, id: true },
  });

  assert(invoice.status === "PAID", "Portal invoice was not paid.");
  assert(Number(invoice.paidAmount) === Number(invoice.amount), "Portal invoice paid amount mismatch.");
  await assertAudit("patient_portal.invoice_paid", "Invoice", invoice.id);

  await postAction("/patient-app", cookie, findActionName(html, "Accept plan"), {
    planId: fixtures.planId,
  });

  const plan = await prisma.treatmentPlan.findUniqueOrThrow({
    where: { id: fixtures.planId },
    select: { status: true },
  });

  assert(plan.status === "ACCEPTED", "Portal treatment plan was not accepted.");
  await assertAudit("patient_portal.treatment_accepted", "TreatmentPlan", fixtures.planId);

  const consentBefore = await prisma.patientConsent.count({ where: { patientId } });

  await postAction("/patient-app", cookie, findActionName(html, "Consent"), {
    patientId,
  });

  const consentAfter = await prisma.patientConsent.count({ where: { patientId } });

  assert(consentAfter === consentBefore + 1, "Portal consent was not renewed.");
  console.log("ok action patient portal confirm/pay/accept/consent");
}

async function createPortalFixtures(patientId, clinicId) {
  const appointmentId = `it-portal-appt-${suffix}`;
  const invoiceNo = `ITP-${suffix}`;
  const planId = `it-portal-plan-${suffix}`;
  const startsAt = new Date("2027-04-10T09:00:00+07:00");

  await prisma.appointment.create({
    data: {
      id: appointmentId,
      clinicId,
      patientId,
      providerId: "user-dentist",
      chairId: "hcm-q1-chair-6",
      status: "REQUESTED",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60000),
      reason: `Portal confirm ${suffix}`,
      source: "patient_portal",
    },
  });

  await prisma.invoice.create({
    data: {
      organizationId: "org_nhavista",
      clinicId,
      patientId,
      invoiceNo,
      status: "OPEN",
      amount: 321000,
      paidAmount: 0,
      dueDate: new Date("2027-04-20T23:59:00+07:00"),
    },
  });

  await prisma.treatmentPlan.create({
    data: {
      id: planId,
      patientId,
      title: `Portal plan ${suffix}`,
      status: "PRESENTED",
      totalAmount: 654000,
      patientDue: 654000,
      phases: {
        create: {
          id: `it-portal-phase-${suffix}`,
          name: "Portal phase",
          sequence: 1,
          procedures: ["Portal approval"],
          estimatedAmount: 654000,
        },
      },
    },
  });

  return { appointmentId, invoiceNo, planId };
}

async function assertPatientRouteRestrictions(patientCookie) {
  for (const route of ["dashboard", "billing", "settings", "patients"]) {
    const response = await fetch(`${baseUrl}/${route}`, {
      headers: { cookie: patientCookie },
      redirect: "manual",
    });

    assert(response.status !== 200, `Patient should not access /${route}.`);
  }

  const portalResponse = await fetch(`${baseUrl}/patient-app`, {
    headers: { cookie: patientCookie },
    redirect: "manual",
  });

  assert(portalResponse.status === 200, "Patient should access /patient-app.");
  console.log("ok permission patient route restrictions");
}

async function directActionPermissionCheck({
  actionCookie,
  patientCookie,
  patientId,
}) {
  const billingHtml = await getPage("/billing", actionCookie);
  const billingAction = findActionName(billingHtml, "Create invoice");
  const blockedAmount = 7654321;
  const before = await prisma.invoice.count({
    where: { patientId, amount: blockedAmount },
  });

  await postAction(
    "/billing",
    patientCookie,
    billingAction,
    {
      patientId,
      amount: String(blockedAmount),
      dueDate: "2027-05-01",
    },
    { allowAnyRedirect: true },
  );

  const after = await prisma.invoice.count({
    where: { patientId, amount: blockedAmount },
  });

  assert(after === before, "Patient direct billing action created an invoice.");
  console.log("ok permission patient route/action restrictions");
}

async function login(email, password) {
  const html = await fetchText("/login");
  const action = findActionName(html, "Sign in");
  const form = new FormData();
  form.set(action, "");
  form.set("email", email);
  form.set("password", password);

  const response = await fetch(`${baseUrl}/login`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });

  assert([303, 200].includes(response.status), `Login failed for ${email}.`);

  const cookie = cookieHeader(response);
  assert(cookie, `Login did not set a cookie for ${email}.`);

  return { cookie };
}

async function getPage(path, cookie) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: cookie ? { cookie } : undefined,
    redirect: "manual",
  });

  assert(response.status === 200, `${path} returned HTTP ${response.status}.`);

  const html = await response.text();
  assert(!html.includes("Runtime Error"), `${path} rendered a runtime error.`);

  return html;
}

async function fetchText(path) {
  const response = await fetch(`${baseUrl}${path}`);

  assert(response.ok, `${path} returned HTTP ${response.status}.`);

  return response.text();
}

async function postAction(path, cookie, actionName, fields, options = {}) {
  const form = new FormData();
  form.set(actionName, "");

  for (const [name, value] of Object.entries(fields)) {
    setFormField(form, name, value);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: form,
    headers: { cookie },
    redirect: "manual",
  });

  if (!options.allowAnyRedirect) {
    assert(
      [303, 200].includes(response.status),
      `${path} action returned HTTP ${response.status}.`,
    );
  }

  return response;
}

async function postPublicAction(path, actionName, fields, options = {}) {
  const form = new FormData();
  form.set(actionName, "");

  for (const [name, value] of Object.entries(fields)) {
    setFormField(form, name, value);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    body: form,
    redirect: "manual",
  });

  if (!options.allowAnyRedirect) {
    assert(
      [303, 200].includes(response.status),
      `${path} public action returned HTTP ${response.status}.`,
    );
  }

  return response;
}

function extractQueryParam(response, name) {
  const redirectTarget =
    response.headers.get("location") ?? response.headers.get("x-action-redirect") ?? "";

  if (!redirectTarget) {
    return "";
  }

  const parsed = new URL(redirectTarget, baseUrl);

  return parsed.searchParams.get(name) ?? "";
}

function setFormField(form, name, value) {
  if (value === undefined || value === null) {
    return;
  }

  if (value && typeof value === "object" && value.kind === "file") {
    form.set(name, value.value, value.filename);
    return;
  }

  form.set(name, value);
}

function fileField(bytes, filename, mimeType) {
  return {
    kind: "file",
    filename,
    value: new Blob([bytes], { type: mimeType }),
  };
}

const markerAliases = new Map([
  ["Accept plan", ["Đồng ý kế hoạch"]],
  ["Confirm", ["Xác nhận"]],
  ["Consent", ["Đồng ý"]],
  ["Complete", ["Hoàn tất"]],
  ["Create booking", ["Tạo lịch hẹn"]],
  ["Create invoice", ["Tạo hóa đơn"]],
  ["Create patient", ["Tạo bệnh nhân"]],
  ["Create prescription", ["Tạo đơn thuốc"]],
  ["Create staff", ["Tạo nhân sự"]],
  ["Create task", ["Tạo task"]],
  ["Deactivate", ["Ngừng kích hoạt"]],
  ["Pay", ["Thanh toán"]],
  ["Payment amount", ["Số tiền trả"]],
  ["Post comment", ["Thêm comment"]],
  ["Publish", ["SHIFT_HANDOFF"]],
  ["Record", ["Ghi nhận"]],
  ["Record progress", ["Ghi nhận tiến độ"]],
  ["Reply", ["Trả lời"]],
  ["Save", ["Lưu"]],
  ["Send form", ["Gửi biểu mẫu"]],
  ["Sign", ["Ký đơn"]],
  ["Sign in", ["Đăng nhập"]],
]);

function findActionName(html, marker) {
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const markers = [marker, ...(markerAliases.get(marker) ?? [])];
  const form = forms.find((candidate) =>
    markers.some((candidateMarker) => candidate.includes(candidateMarker)),
  );

  if (!form) {
    throw new Error(`Could not find form containing "${markers.join('" or "')}".`);
  }

  const action = form.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1];

  if (!action) {
    throw new Error(`Could not find server action field for "${markers.join('" or "')}".`);
  }

  return action;
}

function cookieHeader(response) {
  const setCookie =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie().join(",")
      : response.headers.get("set-cookie");

  return setCookie
    ?.split(/,(?=\s*[^;=]+=[^;]+)/)
    .map((cookie) => cookie.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

async function assertAudit(action, entityType, entityId) {
  const audit = await prisma.auditLog.findFirst({
    where: { action, entityType, entityId },
    select: { id: true },
  });

  assert(audit, `Missing audit log ${action} for ${entityType}:${entityId}.`);
}

async function assertRedirectIncludes(response, notice) {
  const redirectTarget =
    response.headers.get("location") ?? response.headers.get("x-action-redirect") ?? "";

  if (redirectTarget.includes(notice)) {
    return;
  }

  const body = response.bodyUsed ? "" : await response.text();

  assert(
    body.includes(notice),
    `Expected redirect or response body to include "${notice}", got HTTP ${response.status} and "${redirectTarget}".`,
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
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

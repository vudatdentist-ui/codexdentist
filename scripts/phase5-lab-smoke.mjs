import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.ts";
import {
  assertLabTransition,
  createLabCaseCommand,
  listLabCasesCommand,
  transitionLabCaseCommand,
} from "../src/lib/application/lab/commands.ts";

const suffix = randomUUID();
const organizationAId = `phase5-org-a-${suffix}`;
const organizationBId = `phase5-org-b-${suffix}`;
const clinicAId = `phase5-clinic-a-${suffix}`;
const clinicBId = `phase5-clinic-b-${suffix}`;
const patientAId = `phase5-patient-a-${suffix}`;
const patientBId = `phase5-patient-b-${suffix}`;
const userAId = `phase5-user-a-${suffix}`;
const userBId = `phase5-user-b-${suffix}`;

function session(organizationId, organizationName, clinicId, userId) {
  return {
    sessionId: `session-${userId}`,
    userId,
    email: `${userId}@example.test`,
    fullName: "Phase 5 QA Dentist",
    role: "DENTIST",
    roles: ["DENTIST"],
    roleAssignments: [{ role: "DENTIST", organizationId, clinicId }],
    organizationId,
    organizationName,
    organizationSlug: null,
    organizationDomain: null,
    isDemo: false,
    workspaceExpiresAt: null,
    clinicIds: [clinicId],
    clinics: [{ id: clinicId, name: "QA Clinic", city: "HCMC" }],
    activeClinicId: clinicId,
    expiresAt: Date.now() + 3600000,
  };
}

const sessionA = session(organizationAId, "Phase 5 QA A", clinicAId, userAId);
const sessionB = session(organizationBId, "Phase 5 QA B", clinicBId, userBId);
let createdCaseId = null;

try {
  await prisma.organization.createMany({
    data: [
      { id: organizationAId, name: `Phase 5 QA A ${suffix}`, slug: `phase5-qa-a-${suffix}` },
      { id: organizationBId, name: `Phase 5 QA B ${suffix}`, slug: `phase5-qa-b-${suffix}` },
    ],
  });
  await prisma.clinic.createMany({
    data: [
      { id: clinicAId, organizationId: organizationAId, name: `QA Clinic A ${suffix}`, city: "HCMC", address: "QA" },
      { id: clinicBId, organizationId: organizationBId, name: `QA Clinic B ${suffix}`, city: "HCMC", address: "QA" },
    ],
  });
  await prisma.user.createMany({
    data: [
      { id: userAId, organizationId: organizationAId, email: `${userAId}@example.test`, fullName: "Phase 5 QA A", passwordHash: "qa", role: "DENTIST" },
      { id: userBId, organizationId: organizationBId, email: `${userBId}@example.test`, fullName: "Phase 5 QA B", passwordHash: "qa", role: "DENTIST" },
    ],
  });
  await prisma.patient.createMany({
    data: [
      { id: patientAId, organizationId: organizationAId, clinicId: clinicAId, fullName: "Phase 5 Patient A", phone: `07${suffix.replaceAll("-", "").slice(0, 8)}` },
      { id: patientBId, organizationId: organizationBId, clinicId: clinicBId, fullName: "Phase 5 Patient B", phone: `06${suffix.replaceAll("-", "").slice(0, 8)}` },
    ],
  });

  const labCase = await createLabCaseCommand(sessionA, {
    patientId: patientAId,
    title: "Mão sứ răng 11",
    workType: "Crown",
    laboratoryName: "Labo QA",
  });
  createdCaseId = labCase.id;
  assert(labCase.status === "DRAFT", "new lab case starts in draft");
  await transitionLabCaseCommand(sessionA, { id: labCase.id, status: "SENT" });
  let invalidTransition = false;
  try { await transitionLabCaseCommand(sessionA, { id: labCase.id, status: "DELIVERED" }); } catch (error) { invalidTransition = error?.code === "lab-status-transition-invalid"; }
  assert(invalidTransition, "lab cannot skip required production states");
  await transitionLabCaseCommand(sessionA, { id: labCase.id, status: "IN_PROGRESS" });
  await transitionLabCaseCommand(sessionA, { id: labCase.id, status: "READY" });
  const delivered = await transitionLabCaseCommand(sessionA, { id: labCase.id, status: "DELIVERED" });
  assert(delivered.status === "DELIVERED", "lab case can complete through the ordered workflow");
  let pureInvalid = false;
  try { assertLabTransition("DELIVERED", "SENT"); } catch (error) { pureInvalid = error?.code === "lab-status-transition-invalid"; }
  assert(pureInvalid, "terminal lab case cannot reopen");
  const hidden = await listLabCasesCommand(sessionB);
  assert(hidden.length === 0, "other organization cannot list lab cases");
  console.log("ok phase5 lab scope and workflow smoke");
} finally {
  if (createdCaseId) await prisma.labCase.deleteMany({ where: { id: createdCaseId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: [organizationAId, organizationBId] } } }).catch(() => {});
  await prisma.patient.deleteMany({ where: { id: { in: [patientAId, patientBId] } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } }).catch(() => {});
  await prisma.clinic.deleteMany({ where: { id: { in: [clinicAId, clinicBId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [organizationAId, organizationBId] } } }).catch(() => {});
  await prisma.$disconnect();
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase5 lab smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.ts";
import {
  getImagingStudyForScope,
  listImagingStudies,
} from "../src/infrastructure/imaging/store.ts";

const suffix = randomUUID();
const organizationAId = `phase4-org-a-${suffix}`;
const organizationBId = `phase4-org-b-${suffix}`;
const clinicAId = `phase4-clinic-a-${suffix}`;
const clinicBId = `phase4-clinic-b-${suffix}`;
const patientAId = `phase4-patient-a-${suffix}`;
const patientBId = `phase4-patient-b-${suffix}`;
const studyId = `phase4-study-${suffix}`;

try {
  await prisma.organization.createMany({
    data: [
      { id: organizationAId, name: `Phase 4 QA A ${suffix}`, slug: `phase4-qa-a-${suffix}` },
      { id: organizationBId, name: `Phase 4 QA B ${suffix}`, slug: `phase4-qa-b-${suffix}` },
    ],
  });
  await prisma.clinic.createMany({
    data: [
      { id: clinicAId, organizationId: organizationAId, name: `QA Clinic A ${suffix}`, city: "HCMC", address: "QA" },
      { id: clinicBId, organizationId: organizationBId, name: `QA Clinic B ${suffix}`, city: "HCMC", address: "QA" },
    ],
  });
  await prisma.patient.createMany({
    data: [
      { id: patientAId, organizationId: organizationAId, clinicId: clinicAId, fullName: "Phase 4 Patient A", phone: `09${suffix.replaceAll("-", "").slice(0, 8)}` },
      { id: patientBId, organizationId: organizationBId, clinicId: clinicBId, fullName: "Phase 4 Patient B", phone: `08${suffix.replaceAll("-", "").slice(0, 8)}` },
    ],
  });
  await prisma.imagingStudy.create({
    data: {
      id: studyId,
      organizationId: organizationAId,
      clinicId: clinicAId,
      patientId: patientAId,
      connectionId: `phase4-connection-${suffix}`,
      provider: "orthanc",
      externalStudyId: `orthanc-${suffix}`,
      studyInstanceUid: `1.2.826.0.1.3680043.10.${suffix.replaceAll("-", "")}`,
      modalities: ["CT"],
      description: "Phase 4 synthetic QA study",
    },
  });

  const own = await getImagingStudyForScope({ id: studyId, organizationId: organizationAId, clinicIds: [clinicAId] });
  assert(own?.patientId === patientAId, "same-tenant same-clinic patient can read imaging reference");
  const wrongOrganization = await getImagingStudyForScope({ id: studyId, organizationId: organizationBId, clinicIds: [clinicBId] });
  assert(wrongOrganization === null, "other organization cannot read imaging reference");
  const wrongClinic = await getImagingStudyForScope({ id: studyId, organizationId: organizationAId, clinicIds: [clinicBId] });
  assert(wrongClinic === null, "inaccessible clinic cannot read imaging reference");
  const patientStudies = await listImagingStudies({ organizationId: organizationAId, clinicIds: [clinicAId], patientId: patientAId });
  assert(patientStudies.length === 1 && patientStudies[0].patientId === patientAId, "patient filter stays inside tenant and clinic scope");
  console.log("ok phase4 imaging scope smoke");
} finally {
  await prisma.imagingStudy.deleteMany({ where: { id: studyId } }).catch(() => {});
  await prisma.patient.deleteMany({ where: { id: { in: [patientAId, patientBId] } } }).catch(() => {});
  await prisma.clinic.deleteMany({ where: { id: { in: [clinicAId, clinicBId] } } }).catch(() => {});
  await prisma.organization.deleteMany({ where: { id: { in: [organizationAId, organizationBId] } } }).catch(() => {});
  await prisma.$disconnect();
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase4 imaging scope smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

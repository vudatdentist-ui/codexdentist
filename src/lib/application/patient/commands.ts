import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId } from "@/lib/form-validation";
import { hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { ApplicationCommandError } from "@/lib/application/errors";

const patientLeadSourceRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];

export type PatientLeadSource =
  | "WALK_IN"
  | "FACEBOOK_ADS"
  | "GOOGLE_ADS"
  | "TIKTOK"
  | "SOCIAL"
  | "TELESALE"
  | "WEBSITE"
  | "ZALO"
  | "PATIENT_REFERRAL"
  | "STAFF_REFERRAL"
  | "PARTNER"
  | "OTHER";

export type PatientConsentStatus = "GRANTED" | "REVOKED" | "EXPIRED";

export type PatientProfileInput = {
  clinicId: string;
  fullName: string;
  phone: string;
  email: string | null;
  gender: string | null;
  visitReason: string | null;
  dateOfBirth: Date | null;
  guardianName: string | null;
  address: string | null;
  nationalId: string | null;
  medicalAlerts: string[];
};

export async function createPatientCommand(
  session: AppSession,
  input: PatientProfileInput & { leadSource: PatientLeadSource },
) {
  requireAction(session, "patient.create", "patient-denied");
  requireClinicAccess(session, input.clinicId);

  const [clinic, existingPhone, existingNationalId] = await Promise.all([
    prisma.clinic.findFirst({
      where: { id: input.clinicId, organizationId: session.organizationId, active: true },
      select: { id: true },
    }),
    prisma.patient.findUnique({
      where: {
        organizationId_phone: {
          organizationId: session.organizationId,
          phone: input.phone,
        },
      },
      select: { id: true },
    }),
    input.nationalId
      ? prisma.patient.findFirst({
          where: { organizationId: session.organizationId, nationalId: input.nationalId },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!clinic) throw new ApplicationCommandError("patient-clinic-inactive");
  if (existingPhone) throw new ApplicationCommandError("patient-duplicate-phone");
  if (existingNationalId) throw new ApplicationCommandError("patient-duplicate-national-id");

  return prisma.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        organizationId: session.organizationId,
        clinicId: input.clinicId,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        gender: input.gender,
        visitReason: input.visitReason,
        leadSource: input.leadSource,
        dateOfBirth: input.dateOfBirth,
        guardianName: input.guardianName,
        address: input.address,
        nationalId: input.nationalId,
        medicalAlerts: input.medicalAlerts,
      },
      select: { id: true },
    });

    await writePatientAuditLog(tx, session, "patient.created", patient.id, {
      clinicId: input.clinicId,
      phone: input.phone,
      nationalId: input.nationalId,
      leadSource: input.leadSource,
    });

    return patient;
  });
}

export async function updatePatientCommand(
  session: AppSession,
  patientId: string,
  input: PatientProfileInput,
) {
  requireAction(session, "patient.update", "patient-denied");
  requireClinicAccess(session, input.clinicId);

  const [clinic, patient, duplicatePhone, duplicateNationalId] = await Promise.all([
    prisma.clinic.findFirst({
      where: { id: input.clinicId, organizationId: session.organizationId, active: true },
      select: { id: true },
    }),
    prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: { in: session.clinicIds },
      },
      select: { id: true },
    }),
    prisma.patient.findFirst({
      where: {
        organizationId: session.organizationId,
        phone: input.phone,
        id: { not: patientId },
      },
      select: { id: true },
    }),
    input.nationalId
      ? prisma.patient.findFirst({
          where: {
            organizationId: session.organizationId,
            nationalId: input.nationalId,
            id: { not: patientId },
          },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  if (!clinic) throw new ApplicationCommandError("patient-clinic-inactive");
  if (!patient) throw new ApplicationCommandError("patient-not-found");
  if (duplicatePhone) throw new ApplicationCommandError("patient-duplicate-phone");
  if (duplicateNationalId) throw new ApplicationCommandError("patient-duplicate-national-id");

  await prisma.$transaction(async (tx) => {
    await tx.patient.update({
      where: { id: patientId },
      data: {
        clinicId: input.clinicId,
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        gender: input.gender,
        visitReason: input.visitReason,
        dateOfBirth: input.dateOfBirth,
        guardianName: input.guardianName,
        address: input.address,
        nationalId: input.nationalId,
        medicalAlerts: input.medicalAlerts,
      },
    });

    await writePatientAuditLog(tx, session, "patient.updated", patientId, {
      clinicId: input.clinicId,
      phone: input.phone,
    });
  });
}

export async function updatePatientConsentCommand(
  session: AppSession,
  patientId: string,
  status: PatientConsentStatus,
) {
  requireAction(session, "patient.update", "patient-denied");
  await requireScopedPatient(session, patientId);

  await prisma.$transaction(async (tx) => {
    await tx.patientConsent.create({
      data: {
        patientId,
        status,
        purpose: "Health data processing for dental care",
        channel: "staff",
        signedAt: status === "GRANTED" ? new Date() : null,
        version: "vn-simple-v1",
      },
    });
    await writePatientAuditLog(tx, session, "patient.consent_updated", patientId, { status });
  });
}

export async function updatePatientLeadSourceCommand(
  session: AppSession,
  patientId: string,
  leadSource: PatientLeadSource,
  reason: string,
) {
  requireAction(session, "patient.update", "patient-source-denied");
  if (!hasAnyRole(session, patientLeadSourceRoles)) {
    throw new ApplicationCommandError("patient-source-denied");
  }

  const patient = await requireScopedPatientWithLeadSource(session, patientId);
  if (patient.leadSource === leadSource) {
    throw new ApplicationCommandError("patient-source-unchanged");
  }

  await prisma.$transaction(async (tx) => {
    await tx.patient.update({ where: { id: patientId }, data: { leadSource } });
    await writePatientAuditLog(tx, session, "patient.lead_source_updated", patientId, {
      previousLeadSource: patient.leadSource,
      leadSource,
      reason,
    });
  });
}

function requireAction(session: AppSession, action: Parameters<typeof canPerformAction>[1], code: string) {
  if (!canPerformAction(session, action)) throw new ApplicationCommandError(code);
}

function requireClinicAccess(session: AppSession, clinicId: string) {
  if (!session.clinicIds.includes(clinicId)) throw new ApplicationCommandError("clinic-denied");
}

async function requireScopedPatient(session: AppSession, patientId: string) {
  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    select: { id: true },
  });
  if (!patient) throw new ApplicationCommandError("patient-not-found");
  return patient;
}

async function requireScopedPatientWithLeadSource(session: AppSession, patientId: string) {
  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      organizationId: session.organizationId,
      clinicId: { in: session.clinicIds },
    },
    select: { id: true, leadSource: true },
  });
  if (!patient) throw new ApplicationCommandError("patient-not-found");
  return patient;
}

async function writePatientAuditLog(
  tx: Prisma.TransactionClient,
  session: AppSession,
  action: string,
  entityId: string,
  metadata?: Record<string, unknown>,
) {
  await tx.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action,
      entityType: "Patient",
      entityId,
      metadata: metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

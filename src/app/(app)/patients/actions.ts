"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseDateInVietnam,
  requiredString,
  splitList,
} from "@/lib/form-validation";
import { hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const patientLeadSourceRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];

const consentStatuses = ["GRANTED", "REVOKED", "EXPIRED"] as const;
const patientLeadSources = [
  "WALK_IN",
  "FACEBOOK_ADS",
  "GOOGLE_ADS",
  "TIKTOK",
  "SOCIAL",
  "TELESALE",
  "WEBSITE",
  "ZALO",
  "PATIENT_REFERRAL",
  "STAFF_REFERRAL",
  "PARTNER",
  "OTHER",
] as const;

export async function createPatientAction(formData: FormData) {
  const session = await requireViewSession("patients");

  if (!canPerformAction(session, "patient.create")) {
    redirect("/patients?notice=patient-denied");
  }

  const clinicId = requiredString(formData.get("clinicId"));
  const fullName = requiredString(formData.get("fullName"));
  const phone = requiredString(formData.get("phone"));
  const email = optionalString(formData.get("email"));
  const gender = normalizeGender(formData.get("gender"));
  const visitReason = optionalString(formData.get("visitReason"));
  const leadSource = normalizeLeadSource(formData.get("leadSource"));
  const dateOfBirth = parseDateInVietnam(formData.get("dateOfBirth"));
  const guardianName = optionalString(formData.get("guardianName"));
  const address = optionalString(formData.get("address"));
  const nationalId = optionalString(formData.get("nationalId"));
  const medicalAlerts = splitList(formData.get("medicalAlerts"));

  if (!session.clinicIds.includes(clinicId)) {
    redirect("/patients?notice=clinic-denied");
  }

  if (!fullName || !phone) {
    redirect("/patients?notice=patient-missing");
  }

  if (dateOfBirth === "invalid") {
    redirect("/patients?notice=patient-bad-date");
  }

  let notice: string | null = null;
  let createdPatientId = "";

  try {
    const [clinic, existingPhone, existingNationalId] = await Promise.all([
      prisma.clinic.findFirst({
        where: {
          id: clinicId,
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
        },
      }),
      prisma.patient.findUnique({
        where: {
          organizationId_phone: {
            organizationId: session.organizationId,
            phone,
          },
        },
        select: {
          id: true,
        },
      }),
      nationalId
        ? prisma.patient.findFirst({
            where: {
              organizationId: session.organizationId,
              nationalId,
            },
            select: {
              id: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!clinic) {
      notice = "patient-clinic-inactive";
    } else if (existingPhone) {
      notice = "patient-duplicate-phone";
    } else if (existingNationalId) {
      notice = "patient-duplicate-national-id";
    } else {
      const patient = await prisma.patient.create({
        data: {
          organizationId: session.organizationId,
          clinicId,
          fullName,
          phone,
          email,
          gender,
          visitReason,
          leadSource,
          dateOfBirth,
          guardianName,
          address,
          nationalId,
          medicalAlerts,
        },
        select: {
          id: true,
        },
      });
      createdPatientId = patient.id;

      await writePatientAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient.created",
        entityId: patient.id,
        metadata: {
          clinicId,
          phone,
          nationalId,
          leadSource,
        },
      });
    }
  } catch {
    notice = "patient-database";
  }

  if (notice) {
    redirect(`/patients?notice=${notice}`);
  }

  revalidatePath("/patients");
  revalidatePath("/journey");
  redirect(patientRedirect("patient-created", createdPatientId));
}

export async function updatePatientAction(formData: FormData) {
  const session = await requireViewSession("patients");

  if (!canPerformAction(session, "patient.update")) {
    redirect("/patients?notice=patient-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const clinicId = requiredString(formData.get("clinicId"));
  const fullName = requiredString(formData.get("fullName"));
  const phone = requiredString(formData.get("phone"));
  const email = optionalString(formData.get("email"));
  const gender = normalizeGender(formData.get("gender"));
  const visitReason = optionalString(formData.get("visitReason"));
  const dateOfBirth = parseDateInVietnam(formData.get("dateOfBirth"));
  const guardianName = optionalString(formData.get("guardianName"));
  const address = optionalString(formData.get("address"));
  const nationalId = optionalString(formData.get("nationalId"));
  const medicalAlerts = splitList(formData.get("medicalAlerts"));

  if (!patientId || !fullName || !phone) {
    redirect(patientRedirect("patient-missing", patientId));
  }

  if (!session.clinicIds.includes(clinicId)) {
    redirect(patientRedirect("clinic-denied", patientId));
  }

  if (dateOfBirth === "invalid") {
    redirect(patientRedirect("patient-bad-date", patientId));
  }

  let notice: string | null = null;

  try {
    const [clinic, patient, duplicatePhone, duplicateNationalId] = await Promise.all([
      prisma.clinic.findFirst({
        where: {
          id: clinicId,
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
        },
      }),
      prisma.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId: {
            in: session.clinicIds,
          },
        },
        select: {
          id: true,
        },
      }),
      prisma.patient.findFirst({
        where: {
          organizationId: session.organizationId,
          phone,
          id: {
            not: patientId,
          },
        },
        select: {
          id: true,
        },
      }),
      nationalId
        ? prisma.patient.findFirst({
            where: {
              organizationId: session.organizationId,
              nationalId,
              id: {
                not: patientId,
              },
            },
            select: {
              id: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!clinic) {
      notice = "patient-clinic-inactive";
    } else if (!patient) {
      notice = "patient-not-found";
    } else if (duplicatePhone) {
      notice = "patient-duplicate-phone";
    } else if (duplicateNationalId) {
      notice = "patient-duplicate-national-id";
    } else {
      await prisma.patient.update({
        where: {
          id: patientId,
        },
        data: {
          clinicId,
          fullName,
          phone,
          email,
          gender,
          visitReason,
          dateOfBirth,
          guardianName,
          address,
          nationalId,
          medicalAlerts,
        },
      });

      await writePatientAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient.updated",
        entityId: patientId,
        metadata: {
          clinicId,
          phone,
        },
      });
    }
  } catch {
    notice = "patient-database";
  }

  if (notice) {
    redirect(patientRedirect(notice, patientId));
  }

  revalidatePath("/patients");
  revalidatePath("/journey");
  redirect(patientRedirect("patient-updated", patientId));
}

export async function updatePatientConsentAction(formData: FormData) {
  const session = await requireViewSession("patients");

  if (!canPerformAction(session, "patient.update")) {
    redirect("/patients?notice=patient-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const status = requiredString(formData.get("status"));

  if (!patientId || !isConsentStatus(status)) {
    redirect(patientRedirect("patient-bad-consent", patientId));
  }

  let notice: string | null = null;

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      notice = "patient-not-found";
    } else {
      await prisma.patientConsent.create({
        data: {
          patientId,
          status,
          purpose: "Health data processing for dental care",
          channel: "staff",
          signedAt: status === "GRANTED" ? new Date() : null,
          version: "vn-simple-v1",
        },
      });

      await writePatientAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient.consent_updated",
        entityId: patientId,
        metadata: {
          status,
        },
      });
    }
  } catch {
    notice = "patient-database";
  }

  if (notice) {
    redirect(patientRedirect(notice, patientId));
  }

  revalidatePath("/patients");
  redirect(patientRedirect("patient-consent-updated", patientId));
}

export async function updatePatientLeadSourceAction(formData: FormData) {
  const session = await requireViewSession("patients");

  if (!canPerformAction(session, "patient.update") || !canUpdatePatientLeadSource(session)) {
    redirect("/patients?notice=patient-source-denied");
  }

  const patientId = requiredString(formData.get("patientId"));
  const leadSource = normalizeLeadSource(formData.get("leadSource"));
  const reason = optionalString(formData.get("reason"));

  if (!patientId || !reason) {
    redirect(patientRedirect("patient-source-reason-required", patientId));
  }

  let notice: string | null = null;

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
        },
      },
      select: {
        id: true,
        leadSource: true,
      },
    });

    if (!patient) {
      notice = "patient-not-found";
    } else if (patient.leadSource === leadSource) {
      notice = "patient-source-unchanged";
    } else {
      await prisma.$transaction([
        prisma.patient.update({
          where: {
            id: patient.id,
          },
          data: {
            leadSource,
          },
        }),
        prisma.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "patient.lead_source_updated",
            entityType: "Patient",
            entityId: patient.id,
            metadata: {
              previousLeadSource: patient.leadSource,
              leadSource,
              reason,
            } as Prisma.InputJsonValue,
          },
        }),
      ]);
    }
  } catch {
    notice = "patient-database";
  }

  if (notice) {
    redirect(patientRedirect(notice, patientId));
  }

  revalidatePath("/patients");
  revalidatePath("/reports");
  redirect(patientRedirect("patient-source-updated", patientId));
}

function patientRedirect(notice: string, patientId?: string | null) {
  const params = new URLSearchParams({ notice });

  if (patientId) {
    params.set("patientId", patientId);
  }

  return `/patients?${params.toString()}`;
}

function canUpdatePatientLeadSource(session: AppSession) {
  return hasAnyRole(session, patientLeadSourceRoles);
}

function isConsentStatus(
  status: string,
): status is (typeof consentStatuses)[number] {
  return consentStatuses.includes(status as (typeof consentStatuses)[number]);
}

function normalizeGender(value: FormDataEntryValue | null) {
  const gender = requiredString(value).toUpperCase();

  return ["FEMALE", "MALE", "OTHER", "UNKNOWN"].includes(gender) ? gender : null;
}

function normalizeLeadSource(value: FormDataEntryValue | null) {
  const source = requiredString(value).toUpperCase();

  return patientLeadSources.find((candidate) => candidate === source) ?? "WALK_IN";
}

async function writePatientAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: "Patient",
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

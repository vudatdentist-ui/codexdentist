import "server-only";

import { hasAnyRole, canAccessView, canUseAllClinics, type AppRole, type ViewKey } from "@/lib/permissions";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const fileAdminRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];
const cleanFileStatuses = new Set(["CLEAN", "EXTERNAL_URL"]);
const blockedFileStatuses = new Set(["QUARANTINED", "INFECTED"]);

export async function canAccessPatient(session: AppSession, patientId: string) {
  const patient = await prisma.patient.findFirst({
    where: {
      ...patientAccessWhere(session),
      id: patientId,
    },
    select: { id: true },
  });

  return Boolean(patient);
}

export async function getAuthorizedPatientFile(
  session: AppSession,
  fileId: string,
  view: ViewKey = "journey",
) {
  if (!canAccessView(session, view) && !canAccessView(session, "patient-app")) {
    return null;
  }

  const file = await prisma.patientFile.findFirst({
    where: {
      id: fileId,
      organizationId: session.organizationId,
      patient: patientAccessWhere(session),
      OR: [
        {
          sourceType: {
            in: ["LOCAL_UPLOAD", "R2_UPLOAD"],
          },
        },
        {
          storageProvider: {
            in: ["local", "r2"],
          },
        },
      ],
    },
    select: {
      id: true,
      organizationId: true,
      clinicId: true,
      patientId: true,
      fileName: true,
      mimeType: true,
      previewMimeType: true,
      previewStorageKey: true,
      thumbnailMimeType: true,
      thumbnailStorageKey: true,
      sourceId: true,
      storageProvider: true,
      storageKey: true,
      title: true,
      virusScanStatus: true,
    },
  });

  if (!file) {
    return null;
  }

  if (!canServePatientFile(session, file.virusScanStatus)) {
    return {
      ...file,
      blocked: true as const,
    };
  }

  return {
    ...file,
    blocked: false as const,
  };
}

export function canServePatientFile(
  session: AppSession,
  virusScanStatus: string | null,
) {
  const status = virusScanStatus ?? "NOT_SCANNED";

  if (blockedFileStatuses.has(status)) {
    return false;
  }

  if (cleanFileStatuses.has(status)) {
    return true;
  }

  return hasAnyRole(session, fileAdminRoles);
}

export function allowedClinicIdsForResource(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

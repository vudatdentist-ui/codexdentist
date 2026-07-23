import "server-only";

import { patientAccessWhere } from "@/lib/patient-access";
import { hasAnyRole } from "@/lib/permissions";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { PatientFilesWorkspace, PatientFileSummary } from "@/lib/patient-files-types";
import type { AppSession } from "@/lib/session";

const mutableFileRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];

export async function getPatientFilesWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<PatientFilesWorkspace> {
  try {
    const files = await prisma.patientFile.findMany({
      where: {
        organizationId: session.organizationId,
        ...(options.patientId ? { patientId: options.patientId } : {}),
        patient: patientAccessWhere(session),
      },
      include: {
        patient: {
          select: {
            fullName: true,
          },
        },
        uploadedBy: {
          select: {
            fullName: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 200,
    });

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableFileRoles),
      message: null,
      files: files.map(toPatientFileSummary),
    };
  } catch {
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      files: [],
    };
  }
}

export function canMutatePatientFiles(role: AppRole) {
  return mutableFileRoles.includes(role);
}

function toPatientFileSummary(file: {
  id: string;
  patientId: string;
  clinicId: string;
  category: string;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  url: string;
  sizeBytes: number | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  virusScanStatus: string;
  retentionUntil: Date | null;
  sourceType: string | null;
  sourceId: string | null;
  notes: string | null;
  createdAt: Date;
  patient: {
    fullName: string;
  };
  uploadedBy: {
    fullName: string;
  } | null;
}): PatientFileSummary {
  return {
    id: file.id,
    patientId: file.patientId,
    patientName: file.patient.fullName,
    clinicId: file.clinicId,
    uploadedByName: file.uploadedBy?.fullName ?? null,
    category: file.category,
    title: file.title,
    fileName: file.fileName,
    mimeType: file.mimeType,
    url: file.url,
    sizeBytes: file.sizeBytes,
    previewUrl: file.previewUrl,
    thumbnailUrl: file.thumbnailUrl,
    virusScanStatus: file.virusScanStatus,
    retentionUntil: file.retentionUntil ? vietnamDate(file.retentionUntil) : null,
    retentionUntilIso: file.retentionUntil?.toISOString().slice(0, 10) ?? null,
    sourceType: file.sourceType,
    sourceId: file.sourceId,
    notes: file.notes,
    createdAt: vietnamDateTime(file.createdAt),
    createdAtIso: file.createdAt.toISOString(),
  };
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

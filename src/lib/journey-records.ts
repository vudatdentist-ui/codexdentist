import "server-only";

import { patientAccessWhere } from "@/lib/patient-access";
import { hasAnyRole } from "@/lib/permissions";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import type {
  JourneyCommentSummary,
  JourneyRecordsWorkspace,
  PatientOdontogramSummary,
  PatientJourneyStateSummary,
} from "@/lib/journey-records-types";
import { normalizeOdontogramData } from "@/lib/odontogram-data";

const mutableJourneyRecordRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];

export async function getJourneyRecordsWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<JourneyRecordsWorkspace> {
  try {
    const [states, odontograms, comments] = await Promise.all([
      prisma.patientJourneyState.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          patient: patientAccessWhere(session),
        },
        include: {
          updatedBy: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 400,
      }),
      prisma.patientOdontogram.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          patient: patientAccessWhere(session),
        },
        include: {
          updatedBy: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 400,
      }),
      prisma.journeyComment.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          patient: patientAccessWhere(session),
        },
        include: {
          author: {
            select: {
              fullName: true,
            },
          },
          attachments: {
            orderBy: {
              sortOrder: "asc",
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 400,
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableJourneyRecordRoles),
      message: null,
      states: states.map(toStateSummary),
      odontograms: odontograms.flatMap((odontogram) => {
        const summary = toOdontogramSummary(odontogram);
        return summary ? [summary] : [];
      }),
      comments: comments.map(toCommentSummary),
    };
  } catch {
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa lưu được thay đổi. Vui lòng thử lại sau.",
      states: [],
      odontograms: [],
      comments: [],
    };
  }
}

export function canMutateJourneyRecords(role: AppRole) {
  return mutableJourneyRecordRoles.includes(role);
}

function toStateSummary(state: {
  id: string;
  patientId: string;
  clinicId: string;
  treatmentGoal: string | null;
  treatmentPlan: string | null;
  odontogramTeeth: string[];
  updatedAt: Date;
  updatedBy: {
    fullName: string;
  } | null;
}): PatientJourneyStateSummary {
  return {
    id: state.id,
    patientId: state.patientId,
    clinicId: state.clinicId,
    treatmentGoal: state.treatmentGoal ?? "",
    treatmentPlan: state.treatmentPlan ?? "",
    odontogramTeeth: state.odontogramTeeth,
    updatedAt: vietnamDateTime(state.updatedAt),
    updatedByName: state.updatedBy?.fullName ?? null,
  };
}

function toOdontogramSummary(odontogram: {
  id: string;
  patientId: string;
  clinicId: string;
  snapshot: unknown;
  revision: number;
  updatedAt: Date;
  updatedBy: {
    fullName: string;
  } | null;
}): PatientOdontogramSummary | null {
  try {
    return {
      id: odontogram.id,
      patientId: odontogram.patientId,
      clinicId: odontogram.clinicId,
      snapshot: normalizeOdontogramData(odontogram.snapshot),
      revision: odontogram.revision,
      updatedAt: vietnamDateTime(odontogram.updatedAt),
      updatedAtIso: odontogram.updatedAt.toISOString(),
      updatedByName: odontogram.updatedBy?.fullName ?? null,
    };
  } catch {
    return null;
  }
}

function toCommentSummary(comment: {
  id: string;
  patientId: string;
  clinicId: string;
  author: {
    fullName: string;
  } | null;
  body: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachments: Array<{
    id: string;
    url: string;
    name: string | null;
    mimeType: string | null;
    fileKind: string | null;
    sizeBytes: number | null;
    previewUrl: string | null;
    thumbnailUrl: string | null;
    patientFileId: string | null;
  }>;
  createdAt: Date;
}): JourneyCommentSummary {
  const legacyAttachment =
    comment.attachmentUrl && comment.attachments.length === 0
      ? [
          {
            id: `${comment.id}-legacy-attachment`,
            url: comment.attachmentUrl,
            name: comment.attachmentName,
            mimeType: comment.attachmentMime,
            fileKind: null,
            sizeBytes: null,
            previewUrl: null,
            thumbnailUrl: null,
            patientFileId: null,
          },
        ]
      : [];

  return {
    id: comment.id,
    patientId: comment.patientId,
    clinicId: comment.clinicId,
    authorName: comment.author?.fullName ?? "System",
    body: comment.body,
    attachmentUrl: comment.attachmentUrl,
    attachmentName: comment.attachmentName,
    attachmentMime: comment.attachmentMime,
    attachments: comment.attachments.length > 0 ? comment.attachments : legacyAttachment,
    createdAt: vietnamDateTime(comment.createdAt),
    createdAtIso: comment.createdAt.toISOString(),
  };
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

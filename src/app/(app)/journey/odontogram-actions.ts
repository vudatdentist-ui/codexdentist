"use server";

import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import { databaseActorId } from "@/lib/form-validation";
import {
  normalizeOdontogramData,
  OdontogramValidationError,
} from "@/lib/odontogram-data";
import { patientAccessWhere } from "@/lib/patient-access";
import { prisma } from "@/lib/prisma";

export type SavePatientOdontogramResult =
  | {
      ok: true;
      revision: number;
      updatedAt: string;
    }
  | {
      ok: false;
      code: "CONFLICT" | "DENIED" | "INVALID" | "NOT_FOUND" | "UNAVAILABLE";
      message: string;
    };

export async function savePatientOdontogramAction(input: {
  patientId: string;
  expectedRevision: number | null;
  data: unknown;
}): Promise<SavePatientOdontogramResult> {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "clinical.odontogram.update")) {
    return {
      ok: false,
      code: "DENIED",
      message: "Bạn không có quyền cập nhật odontogram.",
    };
  }

  const patientId = String(input.patientId ?? "").trim();
  const expectedRevision = input.expectedRevision;
  if (
    !patientId ||
    (expectedRevision !== null &&
      (!Number.isInteger(expectedRevision) || expectedRevision < 0))
  ) {
    return {
      ok: false,
      code: "INVALID",
      message: "Dữ liệu lưu odontogram không hợp lệ.",
    };
  }

  let snapshot;
  try {
    snapshot = normalizeOdontogramData(input.data);
  } catch (error) {
    if (error instanceof OdontogramValidationError) {
      return {
        ok: false,
        code: "INVALID",
        message: "Odontogram chứa dữ liệu không hợp lệ.",
      };
    }
    throw error;
  }

  let patient;
  try {
    patient = await prisma.patient.findFirst({
      where: {
        ...patientAccessWhere(session),
        id: patientId,
      },
      select: {
        id: true,
        clinicId: true,
      },
    });
  } catch (error) {
    console.error("patient.odontogram_patient_lookup_failed", {
      patientId,
      organizationId: session.organizationId,
      error,
    });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Chưa lưu được odontogram. Vui lòng thử lại.",
    };
  }

  if (!patient) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Không tìm thấy bệnh nhân trong phạm vi được phép.",
    };
  }

  const actorId = databaseActorId(session.userId);
  const snapshotJson = snapshot as Prisma.InputJsonValue;

  try {
    const saved = await prisma.$transaction(async (transaction) => {
      const current = await transaction.patientOdontogram.findFirst({
        where: {
          organizationId: session.organizationId,
          patientId: patient.id,
        },
        select: {
          id: true,
          revision: true,
        },
      });

      if (!current) {
        if (expectedRevision !== null && expectedRevision !== 0) {
          return null;
        }

        const created = await transaction.patientOdontogram.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId: patient.id,
            snapshot: snapshotJson,
            revision: 1,
            updatedById: actorId,
          },
          select: {
            id: true,
            revision: true,
            updatedAt: true,
          },
        });

        await transaction.patientOdontogramRevision.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId: patient.id,
            odontogramId: created.id,
            revision: created.revision,
            snapshot: snapshotJson,
            createdById: actorId,
          },
        });

        await createOdontogramAuditLog(transaction, {
          organizationId: session.organizationId,
          actorId,
          odontogramId: created.id,
          patientId: patient.id,
          revision: created.revision,
        });

        return created;
      }

      if (expectedRevision !== current.revision) {
        return null;
      }

      const nextRevision = current.revision + 1;
      const updated = await transaction.patientOdontogram.updateMany({
        where: {
          id: current.id,
          organizationId: session.organizationId,
          revision: current.revision,
        },
        data: {
          clinicId: patient.clinicId,
          snapshot: snapshotJson,
          revision: nextRevision,
          updatedById: actorId,
        },
      });

      if (updated.count !== 1) {
        return null;
      }

      await transaction.patientOdontogramRevision.create({
        data: {
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          odontogramId: current.id,
          revision: nextRevision,
          snapshot: snapshotJson,
          createdById: actorId,
        },
      });

      await createOdontogramAuditLog(transaction, {
        organizationId: session.organizationId,
        actorId,
        odontogramId: current.id,
        patientId: patient.id,
        revision: nextRevision,
      });

      return transaction.patientOdontogram.findUniqueOrThrow({
        where: {
          id: current.id,
        },
        select: {
          id: true,
          revision: true,
          updatedAt: true,
        },
      });
    });

    if (!saved) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "Odontogram đã được cập nhật ở nơi khác. Hãy tải lại hồ sơ.",
      };
    }

    return {
      ok: true,
      revision: saved.revision,
      updatedAt: saved.updatedAt.toISOString(),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "Odontogram đã được cập nhật ở nơi khác. Hãy tải lại hồ sơ.",
      };
    }

    console.error("patient.odontogram_save_failed", {
      patientId: patient.id,
      organizationId: session.organizationId,
      error,
    });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Chưa lưu được odontogram. Vui lòng thử lại.",
    };
  }
}

async function createOdontogramAuditLog(
  transaction: Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorId: string | null;
    odontogramId: string;
    patientId: string;
    revision: number;
  },
) {
  await transaction.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: "patient.odontogram.updated",
      entityType: "PatientOdontogram",
      entityId: input.odontogramId,
      metadata: {
        patientId: input.patientId,
        revision: input.revision,
      } as Prisma.InputJsonValue,
    },
  });
}

function isUniqueConstraintError(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

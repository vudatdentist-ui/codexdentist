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
import type { PatientOdontogramStage } from "@/lib/journey-records-types";

export type SavePatientOdontogramResult =
  | {
      ok: true;
      stage: PatientOdontogramStage;
      revision: number;
      updatedAt: string;
      initializedCurrent: boolean;
    }
  | {
      ok: false;
      code: "CONFLICT" | "DENIED" | "INVALID" | "NOT_FOUND" | "UNAVAILABLE";
      message: string;
    };

export type ResetPatientOdontogramStagesResult =
  | {
      ok: true;
      revisions: Record<PatientOdontogramStage, number>;
      updatedAt: string;
    }
  | {
      ok: false;
      code: "CONFLICT" | "DENIED" | "INVALID" | "NOT_FOUND" | "UNAVAILABLE";
      message: string;
    };

export async function savePatientOdontogramAction(input: {
  patientId: string;
  stage: PatientOdontogramStage;
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
  const stage = input.stage;
  const expectedRevision = input.expectedRevision;
  if (
    !patientId ||
    !isOdontogramStage(stage) ||
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
          initialRevision: true,
          expectedRevision: true,
          currentRevision: true,
        },
      });

      if (!current) {
        if (
          stage !== "INITIAL" ||
          (expectedRevision !== null && expectedRevision !== 0)
        ) {
          return null;
        }

        const now = new Date();
        const created = await transaction.patientOdontogram.create({
          data: {
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId: patient.id,
            initialSnapshot: snapshotJson,
            currentSnapshot: snapshotJson,
            initialRevision: 1,
            expectedRevision: 0,
            currentRevision: 1,
            initialUpdatedAt: now,
            currentUpdatedAt: now,
            updatedById: actorId,
          },
          select: {
            id: true,
          },
        });

        await transaction.patientOdontogramRevision.createMany({
          data: ["INITIAL", "CURRENT"].map((revisionStage) => ({
            organizationId: session.organizationId,
            clinicId: patient.clinicId,
            patientId: patient.id,
            odontogramId: created.id,
            stage: revisionStage as PatientOdontogramStage,
            revision: 1,
            snapshot: snapshotJson,
            createdById: actorId,
            createdAt: now,
          })),
        });

        await createOdontogramAuditLog(transaction, {
          organizationId: session.organizationId,
          actorId,
          odontogramId: created.id,
          patientId: patient.id,
          stage,
          revision: 1,
        });

        return {
          revision: 1,
          updatedAt: now,
          initializedCurrent: true,
        };
      }

      const currentStageRevision = revisionForStage(current, stage);
      if (expectedRevision !== currentStageRevision) {
        return null;
      }

      const nextRevision = currentStageRevision + 1;
      const now = new Date();
      const updated = await transaction.patientOdontogram.updateMany({
        where: {
          id: current.id,
          organizationId: session.organizationId,
          ...revisionWhere(stage, currentStageRevision),
        },
        data: {
          clinicId: patient.clinicId,
          ...stageUpdateData(stage, snapshotJson, nextRevision, now),
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
          stage,
          revision: nextRevision,
          snapshot: snapshotJson,
          createdById: actorId,
          createdAt: now,
        },
      });

      await createOdontogramAuditLog(transaction, {
        organizationId: session.organizationId,
        actorId,
        odontogramId: current.id,
        patientId: patient.id,
        stage,
        revision: nextRevision,
      });

      return {
        revision: nextRevision,
        updatedAt: now,
        initializedCurrent: false,
      };
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
      stage,
      revision: saved.revision,
      updatedAt: saved.updatedAt.toISOString(),
      initializedCurrent: saved.initializedCurrent,
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

export async function resetPatientOdontogramStagesAction(input: {
  patientId: string;
  expectedRevisions: Record<PatientOdontogramStage, number | null>;
}): Promise<ResetPatientOdontogramStagesResult> {
  const session = await requireViewSession("journey");

  if (!canPerformAction(session, "clinical.odontogram.update")) {
    return {
      ok: false,
      code: "DENIED",
      message: "Bạn không có quyền cập nhật odontogram.",
    };
  }

  const patientId = String(input.patientId ?? "").trim();
  const expectedRevisions = input.expectedRevisions;
  if (
    !patientId ||
    !expectedRevisions ||
    !odontogramStagesHaveValidRevisions(expectedRevisions)
  ) {
    return {
      ok: false,
      code: "INVALID",
      message: "Dữ liệu reset odontogram không hợp lệ.",
    };
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
    console.error("patient.odontogram_reset_patient_lookup_failed", {
      patientId,
      organizationId: session.organizationId,
      error,
    });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Chưa reset được odontogram. Vui lòng thử lại.",
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
  const blankSnapshot = createEmptyOdontogramSnapshot();
  const snapshotJson = blankSnapshot as Prisma.InputJsonValue;

  try {
    const reset = await prisma.$transaction(async (transaction) => {
      const current = await transaction.patientOdontogram.findFirst({
        where: {
          organizationId: session.organizationId,
          patientId: patient.id,
        },
        select: {
          id: true,
          initialRevision: true,
          currentRevision: true,
          expectedRevision: true,
        },
      });

      if (
        !current ||
        current.initialRevision !== expectedRevisions.INITIAL ||
        current.currentRevision !== expectedRevisions.CURRENT ||
        current.expectedRevision !== expectedRevisions.EXPECTED
      ) {
        return null;
      }

      const now = new Date();
      const revisions = {
        INITIAL: current.initialRevision + 1,
        CURRENT: current.currentRevision + 1,
        EXPECTED: current.expectedRevision + 1,
      } satisfies Record<PatientOdontogramStage, number>;
      const updated = await transaction.patientOdontogram.updateMany({
        where: {
          id: current.id,
          organizationId: session.organizationId,
          initialRevision: current.initialRevision,
          currentRevision: current.currentRevision,
          expectedRevision: current.expectedRevision,
        },
        data: {
          clinicId: patient.clinicId,
          initialSnapshot: snapshotJson,
          currentSnapshot: snapshotJson,
          expectedSnapshot: snapshotJson,
          initialRevision: revisions.INITIAL,
          currentRevision: revisions.CURRENT,
          expectedRevision: revisions.EXPECTED,
          initialUpdatedAt: now,
          currentUpdatedAt: now,
          expectedUpdatedAt: now,
          updatedById: actorId,
        },
      });

      if (updated.count !== 1) {
        return null;
      }

      await transaction.patientOdontogramRevision.createMany({
        data: (["INITIAL", "CURRENT", "EXPECTED"] as const).map((stage) => ({
          organizationId: session.organizationId,
          clinicId: patient.clinicId,
          patientId: patient.id,
          odontogramId: current.id,
          stage,
          revision: revisions[stage],
          snapshot: snapshotJson,
          createdById: actorId,
          createdAt: now,
        })),
      });
      for (const stage of ["INITIAL", "CURRENT", "EXPECTED"] as const) {
        await createOdontogramAuditLog(transaction, {
          organizationId: session.organizationId,
          actorId,
          odontogramId: current.id,
          patientId: patient.id,
          stage,
          revision: revisions[stage],
        });
      }

      return { revisions, updatedAt: now };
    });

    if (!reset) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "Odontogram đã được cập nhật ở nơi khác. Hãy tải lại hồ sơ.",
      };
    }

    return {
      ok: true,
      revisions: reset.revisions,
      updatedAt: reset.updatedAt.toISOString(),
    };
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return {
        ok: false,
        code: "CONFLICT",
        message: "Odontogram đã được cập nhật ở nơi khác. Hãy tải lại hồ sơ.",
      };
    }

    console.error("patient.odontogram_reset_failed", {
      patientId: patient.id,
      organizationId: session.organizationId,
      error,
    });
    return {
      ok: false,
      code: "UNAVAILABLE",
      message: "Chưa reset được odontogram. Vui lòng thử lại.",
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
    stage: PatientOdontogramStage;
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
        stage: input.stage,
        revision: input.revision,
      } as Prisma.InputJsonValue,
    },
  });
}

function isOdontogramStage(value: unknown): value is PatientOdontogramStage {
  return value === "INITIAL" || value === "EXPECTED" || value === "CURRENT";
}

function odontogramStagesHaveValidRevisions(
  revisions: Record<PatientOdontogramStage, number | null>,
) {
  return (["INITIAL", "CURRENT", "EXPECTED"] as const).every((stage) => {
    const revision = revisions[stage];
    return Number.isInteger(revision) && Number(revision) >= 0;
  });
}

function createEmptyOdontogramSnapshot() {
  return {
    version: 2 as const,
    entries: [],
    generalAssessment: {
      both: {},
      upper: {},
      lower: {},
      notes: {
        both: "",
        upper: "",
        lower: "",
      },
    },
  };
}

function revisionForStage(
  odontogram: {
    initialRevision: number;
    expectedRevision: number;
    currentRevision: number;
  },
  stage: PatientOdontogramStage,
) {
  if (stage === "INITIAL") {
    return odontogram.initialRevision;
  }
  if (stage === "EXPECTED") {
    return odontogram.expectedRevision;
  }
  return odontogram.currentRevision;
}

function revisionWhere(stage: PatientOdontogramStage, revision: number) {
  if (stage === "INITIAL") {
    return { initialRevision: revision };
  }
  if (stage === "EXPECTED") {
    return { expectedRevision: revision };
  }
  return { currentRevision: revision };
}

function stageUpdateData(
  stage: PatientOdontogramStage,
  snapshot: Prisma.InputJsonValue,
  revision: number,
  updatedAt: Date,
) {
  if (stage === "INITIAL") {
    return {
      initialSnapshot: snapshot,
      initialRevision: revision,
      initialUpdatedAt: updatedAt,
    };
  }
  if (stage === "EXPECTED") {
    return {
      expectedSnapshot: snapshot,
      expectedRevision: revision,
      expectedUpdatedAt: updatedAt,
    };
  }
  return {
    currentSnapshot: snapshot,
    currentRevision: revision,
    currentUpdatedAt: updatedAt,
  };
}

function isUniqueConstraintError(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

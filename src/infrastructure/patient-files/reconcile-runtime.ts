import "server-only";

import { prisma } from "@/lib/prisma";
import { deletePatientFileStageObjects } from "@/infrastructure/patient-files/object-gc";
import { reconcilePatientFilePurgeManifests } from "@/infrastructure/patient-files/purge-manifest";
import {
  reconcilePatientFileStages,
  stageExpiredPatientFiles,
} from "@/infrastructure/patient-files/staging";

export function reconcileStagedPatientFiles(options?: {
  limit?: number;
  retryDelayMs?: number;
  organizationId?: string;
}) {
  return reconcilePatientFilePurgeManifests(
    prisma,
    deletePatientFileStageObjects,
    options,
  ).then((purge) =>
    reconcileExpiredPatientFiles(options).then((expired) =>
      reconcilePatientFileStages(
        prisma,
        deletePatientFileStageObjects,
        options,
      ).then((staged) => ({
        ...purge,
        ...staged,
        expired: expired.claimed,
        expiredStaged: expired.staged,
      })),
    ),
  );
}

async function reconcileExpiredPatientFiles(options?: { limit?: number; organizationId?: string }) {
  try {
    return await stageExpiredPatientFiles(prisma, options);
  } catch (error) {
    console.error("patient_file.retention_reconcile_failed", error);
    throw error;
  }
}

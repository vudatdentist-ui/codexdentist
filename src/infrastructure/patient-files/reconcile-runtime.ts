import "server-only";

import { prisma } from "@/lib/prisma";
import { deletePatientFileStageObjects } from "@/infrastructure/patient-files/object-gc";
import { reconcilePatientFileStages } from "@/infrastructure/patient-files/staging";

export function reconcileStagedPatientFiles(options?: {
  limit?: number;
  retryDelayMs?: number;
}) {
  return reconcilePatientFileStages(
    prisma,
    deletePatientFileStageObjects,
    options,
  );
}

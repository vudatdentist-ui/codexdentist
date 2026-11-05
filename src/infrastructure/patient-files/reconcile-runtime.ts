import "server-only";

import { prisma } from "@/lib/prisma";
import { deletePatientFileStageObjects } from "@/infrastructure/patient-files/object-gc";
import { reconcilePatientFilePurgeManifests } from "@/infrastructure/patient-files/purge-manifest";
import {
  reconcilePatientFileStages,
  stageExpiredPatientFiles,
} from "@/infrastructure/patient-files/staging";

export async function reconcileStagedPatientFiles(options?: {
  limit?: number;
  retryDelayMs?: number;
  organizationId?: string;
}) {
  const purge = await reconcilePatientFilePurgeManifests(
    prisma,
    deletePatientFileStageObjects,
    options,
  );
  const expired = await stageExpiredPatientFiles(prisma, options);
  const staged = await reconcilePatientFileStages(prisma, deletePatientFileStageObjects, options);
  return {
    claimed: purge.claimed + staged.claimed,
    deleted: purge.deleted + staged.deleted,
    failed: purge.failed + staged.failed,
    lostLease: purge.lostLease + staged.lostLease,
    purge,
    staged,
    expired: expired.claimed,
    expiredStaged: expired.staged,
  };
}

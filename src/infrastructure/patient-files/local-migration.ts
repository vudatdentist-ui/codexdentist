import { randomUUID } from "node:crypto";
import type { PatientFile, PrismaClient } from "@prisma/client";
import type { PatientFileStageRow } from "@/infrastructure/patient-files/staging";

// Operator-only storage relocation. Upload, retention and purge still own the
// lifecycle; this transaction moves their single canonical stage with the file.
export async function commitLocalFileMigration(db: PrismaClient, original: PatientFile, storageKey: string) {
  const prefix = `patient-files/${original.organizationId}/${original.patientId}/${original.id}-migration-`;
  if (![original.id, original.organizationId, original.patientId].every(id => /^[a-zA-Z0-9_-]+$/.test(id)) ||
    !storageKey.startsWith(prefix) || !/^[a-zA-Z0-9_-]{8,80}$/.test(storageKey.slice(prefix.length)) ||
    !original.checksumSha256 || !/^[a-f0-9]{64}$/.test(original.checksumSha256) ||
    !Number.isSafeInteger(original.sizeBytes) || (original.sizeBytes ?? 0) <= 0 || original.sizeBytes! > 100 * 1024 * 1024) throw new Error("patient-file-migration-input-invalid");
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `patient-file-organization:${original.organizationId}`);
    const files = await tx.$queryRawUnsafe<PatientFile[]>(
      `SELECT * FROM "PatientFile" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`, original.id, original.organizationId);
    const current = files[0];
    if (!current || current.clinicId !== original.clinicId || current.patientId !== original.patientId ||
      current.storageProvider !== "r2" || current.sourceType !== "R2_UPLOAD" ||
      !current.storageKey || current.storageKey !== original.storageKey || current.sourceId !== original.sourceId || current.storageBucket !== original.storageBucket ||
      current.checksumSha256 !== original.checksumSha256 || current.sizeBytes !== original.sizeBytes ||
      current.updatedAt.getTime() !== original.updatedAt.getTime() ||
      current.previewStorageKey || current.thumbnailStorageKey) throw new Error("patient-file-migration-conflict");
    const stages = await tx.$queryRawUnsafe<PatientFileStageRow[]>(
      `SELECT * FROM "PatientFileObjectStage" WHERE "targetPatientFileId"=$1 FOR UPDATE`, original.id);
    const stage = stages[0];
    if (stage && (stage.state !== "COMMITTED" || stage.storageProvider !== "r2" || stage.storageKey !== original.storageKey ||
      stage.organizationId !== original.organizationId || stage.clinicId !== original.clinicId || stage.patientId !== original.patientId ||
      stage.committedPatientFileId !== original.id || stage.checksumSha256 !== original.checksumSha256 || stage.sizeBytes !== original.sizeBytes ||
      stage.previewStorageKey || stage.thumbnailStorageKey)) throw new Error("patient-file-migration-stage-conflict");
    if (stage) {
      await tx.$executeRawUnsafe(`UPDATE "PatientFileObjectStage" SET "storageProvider"='local', "storageKey"=$2,
        "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE "id"=$1`, stage.id, storageKey);
    } else {
      await tx.$executeRawUnsafe(`INSERT INTO "PatientFileObjectStage"
        ("id","organizationId","clinicId","patientId","uploadedById","targetPatientFileId","committedPatientFileId",
         "fileName","mimeType","sizeBytes","storageProvider","storageKey","checksumSha256","state","storedAt","committedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,'local',$10,$11,'COMMITTED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`,
        randomUUID(), original.organizationId, original.clinicId, original.patientId, original.uploadedById,
        original.id, original.fileName ?? original.title, original.mimeType ?? "application/octet-stream", original.sizeBytes,
        storageKey, original.checksumSha256);
    }
    await tx.patientFile.update({ where: { id: original.id }, data: {
      storageProvider: "local", storageBucket: null, storageKey, sourceId: storageKey, sourceType: "LOCAL_UPLOAD",
    } });
    await tx.auditLog.create({ data: {
      organizationId: original.organizationId, actorId: null, action: "patient_file.storage_migrated",
      entityType: "PatientFile", entityId: original.id,
      metadata: { clinicId: original.clinicId, patientId: original.patientId, from: "r2", to: "local",
        checksumSha256: original.checksumSha256, sizeBytes: original.sizeBytes, sourcePreserved: true },
    } });
    return { migrated: true, sizeBytes: original.sizeBytes };
  }, { timeout: 30_000 });
}

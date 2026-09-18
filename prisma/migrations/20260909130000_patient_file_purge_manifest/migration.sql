CREATE TABLE "PatientFilePurgeManifest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewStorageKey" TEXT,
    "thumbnailStorageKey" TEXT,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientFilePurgeManifest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PatientFilePurgeManifest_state_availableAt_idx"
ON "PatientFilePurgeManifest"("state", "availableAt");

CREATE INDEX "PatientFilePurgeManifest_organizationId_idx"
ON "PatientFilePurgeManifest"("organizationId");

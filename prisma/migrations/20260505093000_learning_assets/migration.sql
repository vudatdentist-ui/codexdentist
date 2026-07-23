CREATE TABLE "LearningAsset" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "contentId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "url" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "storageProvider" TEXT,
    "storageBucket" TEXT,
    "storageKey" TEXT,
    "checksumSha256" TEXT,
    "previewUrl" TEXT,
    "previewMimeType" TEXT,
    "previewSizeBytes" INTEGER,
    "previewStorageKey" TEXT,
    "thumbnailUrl" TEXT,
    "thumbnailMimeType" TEXT,
    "thumbnailSizeBytes" INTEGER,
    "thumbnailStorageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningAsset_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LearningAsset_contentId_createdAt_idx" ON "LearningAsset"("contentId", "createdAt");
CREATE INDEX "LearningAsset_clinicId_createdAt_idx" ON "LearningAsset"("clinicId", "createdAt");
CREATE INDEX "LearningAsset_organizationId_kind_idx" ON "LearningAsset"("organizationId", "kind");

ALTER TABLE "LearningAsset" ADD CONSTRAINT "LearningAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LearningAsset" ADD CONSTRAINT "LearningAsset_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LearningAsset" ADD CONSTRAINT "LearningAsset_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "LearningContent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearningAsset" ADD CONSTRAINT "LearningAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

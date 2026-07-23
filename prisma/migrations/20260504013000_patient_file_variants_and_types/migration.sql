ALTER TABLE "PatientFile"
  ADD COLUMN "previewUrl" TEXT,
  ADD COLUMN "previewMimeType" TEXT,
  ADD COLUMN "previewSizeBytes" INTEGER,
  ADD COLUMN "previewStorageKey" TEXT,
  ADD COLUMN "thumbnailUrl" TEXT,
  ADD COLUMN "thumbnailMimeType" TEXT,
  ADD COLUMN "thumbnailSizeBytes" INTEGER,
  ADD COLUMN "thumbnailStorageKey" TEXT;

ALTER TABLE "JourneyCommentAttachment"
  ADD COLUMN "fileKind" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "previewUrl" TEXT,
  ADD COLUMN "thumbnailUrl" TEXT;

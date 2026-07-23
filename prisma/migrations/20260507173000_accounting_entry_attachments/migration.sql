ALTER TABLE "AccountingEntry"
  ADD COLUMN "attachmentFileName" TEXT,
  ADD COLUMN "attachmentMimeType" TEXT,
  ADD COLUMN "attachmentSizeBytes" INTEGER,
  ADD COLUMN "attachmentStorageProvider" TEXT,
  ADD COLUMN "attachmentStorageKey" TEXT,
  ADD COLUMN "attachmentThumbnailMimeType" TEXT,
  ADD COLUMN "attachmentThumbnailStorageKey" TEXT;

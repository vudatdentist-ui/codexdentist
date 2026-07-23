CREATE TABLE IF NOT EXISTS "JourneyCommentAttachment" (
  "id" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "patientFileId" TEXT,
  "url" TEXT NOT NULL,
  "name" TEXT,
  "mimeType" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JourneyCommentAttachment_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'JourneyCommentAttachment_commentId_fkey'
  ) THEN
    ALTER TABLE "JourneyCommentAttachment"
    ADD CONSTRAINT "JourneyCommentAttachment_commentId_fkey"
    FOREIGN KEY ("commentId") REFERENCES "JourneyComment"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "JourneyCommentAttachment_commentId_sortOrder_idx"
  ON "JourneyCommentAttachment"("commentId", "sortOrder");

CREATE INDEX IF NOT EXISTS "JourneyCommentAttachment_patientFileId_idx"
  ON "JourneyCommentAttachment"("patientFileId");

CREATE TABLE "GlobalDocumentSequence" (
  "type" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "currentValue" INTEGER NOT NULL,
  CONSTRAINT "GlobalDocumentSequence_pkey" PRIMARY KEY ("type", "year")
);

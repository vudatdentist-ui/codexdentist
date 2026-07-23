CREATE TABLE "AiRun" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "clinicId" TEXT,
  "actorId" TEXT,
  "module" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "baseUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "input" JSONB,
  "output" JSONB,
  "rawOutput" TEXT,
  "error" TEXT,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "totalTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiRun_organizationId_module_createdAt_idx" ON "AiRun"("organizationId", "module", "createdAt");
CREATE INDEX "AiRun_clinicId_createdAt_idx" ON "AiRun"("clinicId", "createdAt");
CREATE INDEX "AiRun_actorId_createdAt_idx" ON "AiRun"("actorId", "createdAt");
CREATE INDEX "AiRun_status_createdAt_idx" ON "AiRun"("status", "createdAt");

ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

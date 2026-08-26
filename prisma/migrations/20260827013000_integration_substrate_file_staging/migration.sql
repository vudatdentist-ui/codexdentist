-- Phase 2: provider-neutral integration substrate and recoverable patient-file object staging.

CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "capabilities" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "secretRef" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrationConnection_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED', 'ERROR'))
);

CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "internalId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntegrationInbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "connectionId" TEXT,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationInbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrationInbox_status_check" CHECK ("status" IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'RETRY', 'FAILED')),
    CONSTRAINT "IntegrationInbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE TABLE "IntegrationOutbox" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT,
    "topic" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT,
    "aggregateId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "dedupeKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockToken" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntegrationOutbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IntegrationOutbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'RETRY', 'FAILED')),
    CONSTRAINT "IntegrationOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE TABLE "PatientFileObjectStage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clinicId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "targetPatientFileId" TEXT NOT NULL,
    "committedPatientFileId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "previewStorageKey" TEXT,
    "thumbnailStorageKey" TEXT,
    "checksumSha256" TEXT,
    "state" TEXT NOT NULL DEFAULT 'STAGED',
    "storedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "gcAfter" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    "lastErrorCode" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PatientFileObjectStage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PatientFileObjectStage_targetPatientFileId_key" UNIQUE ("targetPatientFileId"),
    CONSTRAINT "PatientFileObjectStage_committedPatientFileId_key" UNIQUE ("committedPatientFileId"),
    CONSTRAINT "PatientFileObjectStage_state_check" CHECK ("state" IN ('STAGED', 'COMMITTED', 'GC_PENDING', 'DELETED')),
    CONSTRAINT "PatientFileObjectStage_sizeBytes_check" CHECK ("sizeBytes" >= 0)
);

ALTER TABLE "IntegrationConnection"
    ADD CONSTRAINT "IntegrationConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "IntegrationConnection_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalReference"
    ADD CONSTRAINT "ExternalReference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ExternalReference_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "ExternalReference_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationInbox"
    ADD CONSTRAINT "IntegrationInbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "IntegrationInbox_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "IntegrationInbox_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "IntegrationConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IntegrationOutbox"
    ADD CONSTRAINT "IntegrationOutbox_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "IntegrationOutbox_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientFileObjectStage"
    ADD CONSTRAINT "PatientFileObjectStage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "PatientFileObjectStage_clinicId_fkey" FOREIGN KEY ("clinicId") REFERENCES "Clinic"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "PatientFileObjectStage_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "PatientFileObjectStage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "PatientFileObjectStage_committedPatientFileId_fkey" FOREIGN KEY ("committedPatientFileId") REFERENCES "PatientFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "IntegrationConnection_org_provider_scope_key"
    ON "IntegrationConnection" ("organizationId", "provider", COALESCE("clinicId", ''));
CREATE INDEX "IntegrationConnection_org_status_idx"
    ON "IntegrationConnection" ("organizationId", "status");

CREATE UNIQUE INDEX "ExternalReference_external_key"
    ON "ExternalReference" ("organizationId", "provider", "entityType", COALESCE("connectionId", ''), "externalId");
CREATE UNIQUE INDEX "ExternalReference_internal_key"
    ON "ExternalReference" ("organizationId", "provider", "entityType", COALESCE("connectionId", ''), "internalId");
CREATE INDEX "ExternalReference_internal_lookup_idx"
    ON "ExternalReference" ("organizationId", "entityType", "internalId");

CREATE UNIQUE INDEX "IntegrationInbox_event_key"
    ON "IntegrationInbox" ("organizationId", "provider", COALESCE("connectionId", ''), "externalEventId");
CREATE INDEX "IntegrationInbox_dispatch_idx"
    ON "IntegrationInbox" ("status", "availableAt", "createdAt");
CREATE INDEX "IntegrationInbox_org_created_idx"
    ON "IntegrationInbox" ("organizationId", "createdAt");

CREATE UNIQUE INDEX "IntegrationOutbox_dedupe_key"
    ON "IntegrationOutbox" ("organizationId", "topic", "dedupeKey") WHERE "dedupeKey" IS NOT NULL;
CREATE INDEX "IntegrationOutbox_dispatch_idx"
    ON "IntegrationOutbox" ("status", "availableAt", "createdAt");
CREATE INDEX "IntegrationOutbox_org_created_idx"
    ON "IntegrationOutbox" ("organizationId", "createdAt");

CREATE INDEX "PatientFileObjectStage_reconcile_idx"
    ON "PatientFileObjectStage" ("state", "gcAfter", "createdAt");
CREATE INDEX "PatientFileObjectStage_patient_idx"
    ON "PatientFileObjectStage" ("organizationId", "patientId", "createdAt");

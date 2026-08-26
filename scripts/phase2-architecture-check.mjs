import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const findings = [];

const journey = source("src/lib/application/journey/commands.ts");
assertMarkers("src/lib/application/journey/commands.ts", journey, [
  "createPatientFileStage",
  "storePatientUpload",
  "markPatientFileStageStored",
  "markPatientFileStageCommitted",
  "markPatientFileStageGcPending",
  "enqueueIntegrationOutbox",
  'eventType: "patient_file.committed"',
]);
assertCallOrder(journey, [
  "await createPatientFileStage",
  "await storePatientUpload",
  "await markPatientFileStageStored",
  "await markPatientFileStageCommitted",
]);

const substrate = source("src/infrastructure/integrations/substrate.ts");
assertMarkers("src/infrastructure/integrations/substrate.ts", substrate, [
  "acceptIntegrationInbox",
  "processIntegrationInbox",
  "enqueueIntegrationOutbox",
  "dispatchIntegrationOutbox",
  "FOR UPDATE SKIP LOCKED",
  "integration.outbox_retry_scheduled",
  "integration.inbox_retry_scheduled",
  "payloadHash",
]);

const staging = source("src/infrastructure/patient-files/staging.ts");
assertMarkers("src/infrastructure/patient-files/staging.ts", staging, [
  '"state" = \'COMMITTED\'',
  '"state" = \'GC_PENDING\'',
  '"state" = \'DELETED\'',
  "reconcilePatientFileStages",
  "FOR UPDATE SKIP LOCKED",
]);

const gcRoute = source("src/app/api/jobs/patient-file-gc/route.ts");
assertMarkers("src/app/api/jobs/patient-file-gc/route.ts", gcRoute, [
  "verifyJobRequest(request)",
  "reconcileStagedPatientFiles",
]);

const migration = source(
  "prisma/migrations/20260827013000_integration_substrate_file_staging/migration.sql",
);
assertMarkers("phase2 migration", migration, [
  'CREATE TABLE "IntegrationConnection"',
  'CREATE TABLE "ExternalReference"',
  'CREATE TABLE "IntegrationInbox"',
  'CREATE TABLE "IntegrationOutbox"',
  'CREATE TABLE "PatientFileObjectStage"',
  'CREATE UNIQUE INDEX "IntegrationInbox_event_key"',
  'CREATE UNIQUE INDEX "IntegrationOutbox_dedupe_key"',
  "GC_PENDING",
  "COMMITTED",
]);

const prismaConfig = source("prisma.config.ts");
assertMarkers("prisma.config.ts", prismaConfig, [
  'schema: "prisma"',
  "externalTables: true",
  '"public.IntegrationConnection"',
  '"public.PatientFileObjectStage"',
]);

walkIntegrations("src/integrations");

if (findings.length) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("phase2-architecture-check: ok");
}

function source(path) {
  return readFileSync(path, "utf8");
}

function assertMarkers(label, text, markers) {
  for (const marker of markers) {
    if (!text.includes(marker)) findings.push(`${label}: missing marker ${marker}`);
  }
}

function assertCallOrder(text, markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = text.indexOf(marker);
    if (index < 0) {
      findings.push(`journey staged upload: missing call ${marker}`);
      return;
    }
    if (index <= previous) {
      findings.push(
        `journey staged upload: ${marker} must occur after ${markers[markers.indexOf(marker) - 1]}`,
      );
    }
    previous = index;
  }
}

function walkIntegrations(root) {
  if (!existsSync(root)) return;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkIntegrations(path);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx)$/.test(name)) continue;
    const text = readFileSync(path, "utf8");
    for (const forbidden of ["@/lib/prisma", "@prisma/client", "@prisma/adapter-pg"]) {
      if (text.includes(forbidden)) {
        findings.push(`${path}: provider adapter must not import ${forbidden}`);
      }
    }
  }
}

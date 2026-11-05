import { readFile } from "node:fs/promises";

const files = {
  schema: "prisma/schema.prisma",
  migration: "prisma/migrations/20260908100000_lab_cases/migration.sql",
  commands: "src/lib/application/lab/commands.ts",
  api: "src/app/api/lab/cases/route.ts",
  status: "src/app/api/lab/cases/[caseId]/status/route.ts",
  page: "src/app/(app)/lab/page.tsx",
  sterilization: "src/lib/application/sterilization/commands.ts",
  labDomain: "src/domains/operations/lab.ts",
  sterilizationDomain: "src/domains/operations/sterilization.ts",
  sterilizationApi: "src/app/api/sterilization/cycles/route.ts",
  integrityMigration: "prisma/migrations/20260909140000_tenant_consistency_composite_fks/migration.sql",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")])));

assert(source.schema.includes("model LabCase"), "LabCase is a native bounded model");
assert(source.schema.includes("patientId") && source.schema.includes("clinicId") && source.schema.includes("treatmentServiceId"), "lab case references canonical patient, clinic, and treatment service");
assert(source.migration.includes('CREATE TABLE "LabCase"') && source.migration.includes('"organizationId"'), "lab migration is tenant scoped");
assert(source.commands.includes('organizationId: session.organizationId') && source.commands.includes("allowedClinicIds(session)"), "lab commands enforce tenant and clinic scope");
assert(source.commands.includes("assertLabTransition") && source.labDomain.includes('"IN_PROGRESS"') && source.labDomain.includes('"DELIVERED"'), "lab status transitions are explicit");
assert(source.commands.includes('entityType: "LabCase"') && source.commands.includes("lab.case_status_changed"), "lab transitions are auditable");
assert(source.api.includes("createLabCaseCommand") && source.status.includes("transitionLabCaseCommand"), "lab routes dispatch through application commands");
assert(!/Patient|Appointment|Billing.*source|Prisma/.test(source.page), "lab UI does not introduce a second core source of truth");
assert(source.schema.includes("model SterilizationInstrument") && source.schema.includes("model SterilizationCycle"), "sterilization traceability has native models");
assert(
  /clinic\s+Clinic\s+@relation\(fields: \[clinicId, organizationId\]/.test(source.schema) &&
    /cycle\s+SterilizationCycle\s+@relation\(fields: \[cycleId, organizationId, clinicId\]/.test(source.schema) &&
    /instrument\s+SterilizationInstrument\s+@relation\(fields: \[instrumentId, organizationId, clinicId\]/.test(source.schema) &&
    source.integrityMigration.includes('SterilizationCycleInstrument_clinic_organization_fkey') &&
    source.integrityMigration.includes('PatientFileObjectStage_patientId_clinicId_organizationId_fkey'),
  "sterilization records enforce composite tenant and clinic consistency",
);
assert(source.sterilization.includes("organizationId: session.organizationId") && source.sterilization.includes("clinicId"), "sterilization commands enforce tenant and clinic scope");
assert(
  source.sterilization.includes("assertSterilizationTransition") &&
    source.sterilizationDomain.includes('"RUNNING"') &&
    /instruments:\s*\{\s*create:/.test(source.sterilization) &&
    source.sterilization.includes("id_organizationId_clinicId") &&
    source.sterilization.includes("id_organizationId: { id: clinicId"),
  "sterilization cycle transition and scoped load membership are explicit",
);
assert(!/@prisma|next\/|lib\/prisma|infrastructure\//.test(source.labDomain) && !/@prisma|next\/|lib\/prisma|infrastructure\//.test(source.sterilizationDomain), "operations domain rules remain framework and persistence independent");
assert(source.sterilization.includes("sterilization.cycle_status_changed") && source.sterilizationApi.includes("createSterilizationCycleCommand"), "sterilization actions are audited and routed through commands");
console.log("phase5-architecture-check: ok");

function assert(condition, label) {
  if (!condition) throw new Error(`Phase5 architecture check failed: ${label}`);
  console.log(`ok ${label}`);
}

import { readFile } from "node:fs/promises";

const files = {
  schema: "prisma/schema.prisma",
  migration: "prisma/migrations/20260908100000_lab_cases/migration.sql",
  commands: "src/lib/application/lab/commands.ts",
  api: "src/app/api/lab/cases/route.ts",
  status: "src/app/api/lab/cases/[caseId]/status/route.ts",
  page: "src/app/(app)/lab/page.tsx",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")])));

assert(source.schema.includes("model LabCase"), "LabCase is a native bounded model");
assert(source.schema.includes("patientId") && source.schema.includes("clinicId") && source.schema.includes("treatmentServiceId"), "lab case references canonical patient, clinic, and treatment service");
assert(source.migration.includes('CREATE TABLE "LabCase"') && source.migration.includes('"organizationId"'), "lab migration is tenant scoped");
assert(source.commands.includes('organizationId: session.organizationId') && source.commands.includes('clinicId: { in: session.clinicIds }'), "lab commands enforce tenant and clinic scope");
assert(source.commands.includes("assertLabTransition") && source.commands.includes('"IN_PROGRESS"') && source.commands.includes('"DELIVERED"'), "lab status transitions are explicit");
assert(source.commands.includes('entityType: "LabCase"') && source.commands.includes("lab.case_status_changed"), "lab transitions are auditable");
assert(source.api.includes("createLabCaseCommand") && source.status.includes("transitionLabCaseCommand"), "lab routes dispatch through application commands");
assert(!/Patient|Appointment|Billing.*source|Prisma/.test(source.page), "lab UI does not introduce a second core source of truth");
console.log("phase5-architecture-check: ok");

function assert(condition, label) {
  if (!condition) throw new Error(`Phase5 architecture check failed: ${label}`);
  console.log(`ok ${label}`);
}

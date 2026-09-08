import { readFile } from "node:fs/promises";
const files = {
  client: "src/integrations/fhir/patient.ts",
  command: "src/lib/application/interoperability/commands.ts",
  route: "src/app/api/integrations/fhir/patients/[patientId]/route.ts",
  env: "src/lib/env.ts",
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, "utf8")])));
assert(!/@prisma|lib\/prisma|fetch\(/.test(source.client), "FHIR mapper is a pure optional adapter");
assert(source.command.includes("fhirExportEnabled") && source.command.includes("patientAccessWhere(session)"), "FHIR export is disabled by default and tenant scoped");
assert(source.route.includes("exportFhirPatientCommand") && !source.route.includes("prisma."), "FHIR transport dispatches through an application command");
assert(source.client.includes("resourceType: \"Patient\"") && source.client.includes("identifier"), "FHIR mapping is an external representation, not a domain model");
console.log("phase6-architecture-check: ok");
function assert(condition, label) { if (!condition) throw new Error(`Phase6 architecture check failed: ${label}`); console.log(`ok ${label}`); }

const { toFhirPatient } = await import("../src/integrations/fhir/patient.ts");
const resource = toFhirPatient({ id: "patient-fhir-1", fullName: "Nguyen Van An", dateOfBirth: new Date("1990-01-02T00:00:00Z"), gender: "MALE", phone: "0900000000", email: "an@example.test", address: "HCMC" });
assert(resource.resourceType === "Patient", "FHIR resource type is Patient");
assert(resource.identifier[0].value === "patient-fhir-1", "FHIR identifier uses stable internal reference");
assert(resource.name[0].family === "An" && resource.name[0].given[0] === "Nguyen", "Vietnamese name mapping is deterministic");
assert(resource.gender === "male" && resource.birthDate === "1990-01-02", "FHIR demographic fields are normalized");
assert(!Object.hasOwn(resource, "medicalAlerts"), "FHIR mapper minimizes clinical data");
console.log("ok phase6 FHIR smoke");
function assert(condition, label) { if (!condition) throw new Error(`Phase6 FHIR smoke failed: ${label}`); console.log(`ok ${label}`); }

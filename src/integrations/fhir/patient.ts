export type FhirPatientSource = {
  id: string;
  fullName: string;
  dateOfBirth: Date | null;
  gender: string | null;
  phone: string;
  email: string | null;
  address: string | null;
};

export function toFhirPatient(patient: FhirPatientSource) {
  const [family, ...given] = patient.fullName.trim().split(/\s+/).reverse();
  return {
    resourceType: "Patient",
    id: patient.id,
    meta: { profile: ["https://codexdentist.com/fhir/StructureDefinition/codexdentist-patient"] },
    identifier: [{ system: "https://codexdentist.com/fhir/patient", value: patient.id }],
    name: [{ use: "official", family: family || patient.fullName, given: given.reverse() }],
    ...(patient.gender ? { gender: mapGender(patient.gender) } : {}),
    ...(patient.dateOfBirth ? { birthDate: patient.dateOfBirth.toISOString().slice(0, 10) } : {}),
    telecom: [
      ...(patient.phone ? [{ system: "phone", value: patient.phone, use: "mobile" }] : []),
      ...(patient.email ? [{ system: "email", value: patient.email, use: "home" }] : []),
    ],
    ...(patient.address ? { address: [{ text: patient.address, use: "home" }] } : {}),
  };
}

function mapGender(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "male" || normalized === "nam" ? "male" : normalized === "female" || normalized === "nữ" || normalized === "nu" ? "female" : "unknown";
}

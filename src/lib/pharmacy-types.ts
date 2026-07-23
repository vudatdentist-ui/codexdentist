export type PharmacyPatientOption = {
  id: string;
  name: string;
  phone: string | null;
  clinicId: string;
};

export type MedicationCatalogSummary = {
  id: string;
  code: string;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  form: string | null;
  defaultSig: string | null;
  defaultDose: string | null;
  route: string | null;
  frequency: string | null;
  warnings: string[];
  active: boolean;
};

export type PrescriptionTemplateSummary = {
  id: string;
  code: string;
  name: string;
  diagnosis: string | null;
  instructions: string | null;
  active: boolean;
  items: Array<{
    id: string;
    medicationId: string | null;
    drugName: string;
    sig: string;
    quantity: string | null;
    refills: number;
    durationDays: number | null;
    instructions: string | null;
  }>;
};

export type PrescriptionSummary = {
  id: string;
  prescriptionNo: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  prescriberName: string;
  status: "DRAFT" | "SIGNED" | "DISPENSED" | "CANCELLED";
  diagnosis: string | null;
  notes: string | null;
  signedAt: string | null;
  signedAtIso: string | null;
  printedAt: string | null;
  printedAtIso: string | null;
  createdAt: string;
  createdAtIso: string;
  items: Array<{
    id: string;
    medicationId: string | null;
    drugName: string;
    strength: string | null;
    sig: string;
    quantity: string | null;
    refills: number;
    durationDays: number | null;
    instructions: string | null;
  }>;
};

export type PharmacyWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patients: PharmacyPatientOption[];
  medications: MedicationCatalogSummary[];
  templates: PrescriptionTemplateSummary[];
  prescriptions: PrescriptionSummary[];
};

export type PrintablePrescription = PrescriptionSummary & {
  organizationName: string;
  clinicName: string;
  clinicCity: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  patientDateOfBirth: string | null;
  patientAge: string | null;
  patientGender: string | null;
  patientNationalId: string | null;
  patientGuardianName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  patientAddress: string | null;
};

export type PrintablePrescriptionTemplate = {
  templateCode: string;
  templateName: string;
  organizationName: string;
  clinicName: string;
  clinicCity: string;
  clinicAddress: string;
  clinicPhone: string;
  patientName: string;
  patientDateOfBirth: string;
  patientAge: string;
  patientGender: string;
  patientNationalId: string;
  patientGuardianName: string;
  patientPhone: string;
  patientAddress: string;
  diagnosis: string;
  notes: string | null;
  prescriberName: string;
  createdAt: string;
  items: Array<{
    id: string;
    drugName: string;
    sig: string;
    quantity: string | null;
    durationDays: number | null;
    instructions: string | null;
  }>;
};

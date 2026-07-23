import type { Appointment, Invoice, TreatmentPlan } from "@/lib/data";

export type PortalPatientSummary = {
  id: string;
  name: string;
  clinicId: string;
  clinic: string;
  phone: string;
  email: string | null;
  consent: string;
};

export type PortalPatientFileSummary = {
  id: string;
  category: string;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  url: string;
  createdAt: string;
};

export type PortalTreatmentServiceSummary = {
  id: string;
  serviceCode: string;
  serviceName: string;
  targetSummary: string | null;
  status: string;
  finalPrice: number;
  currentProgressPercent: number;
  collectedAmount: number;
  remainingAmount: number;
  updatedAt: string;
};

export type PatientPortalWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patient: PortalPatientSummary | null;
  appointments: Appointment[];
  invoices: Invoice[];
  treatmentPlans: TreatmentPlan[];
  patientFiles: PortalPatientFileSummary[];
  treatmentServices: PortalTreatmentServiceSummary[];
};

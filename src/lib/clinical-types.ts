import type { Patient } from "@/lib/data";

export type ClinicalNoteSummary = {
  id: string;
  patientId: string;
  patient: string;
  author: string;
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  lockedAt: string | null;
  createdAt: string;
  createdAtIso: string | null;
};

export type ClinicalWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patients: Patient[];
  notes: ClinicalNoteSummary[];
};

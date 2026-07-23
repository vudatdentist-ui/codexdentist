import type { Clinic, Patient } from "@/lib/data";

export type PatientWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  clinics: Clinic[];
  patients: Patient[];
};

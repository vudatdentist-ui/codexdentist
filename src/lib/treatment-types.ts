import type { TreatmentPlan } from "@/lib/data";

export type TreatmentPatientOption = {
  id: string;
  name: string;
  clinicId: string;
};

export type TreatmentWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patients: TreatmentPatientOption[];
  plans: TreatmentPlan[];
};

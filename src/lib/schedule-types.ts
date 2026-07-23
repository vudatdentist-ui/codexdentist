import type { Appointment, Clinic } from "@/lib/data";

export type SchedulePatientOption = {
  id: string;
  name: string;
  clinicId: string;
  phone: string;
};

export type ScheduleProviderOption = {
  id: string;
  name: string;
  role: string;
  clinicIds: string[];
  operationalStatus?: "READY" | "BUSY";
};

export type ScheduleChairOption = {
  id: string;
  name: string;
  clinicId: string;
  operationalStatus?: "READY" | "BUSY";
};

export type ScheduleWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  clinics: Clinic[];
  patients: SchedulePatientOption[];
  providers: ScheduleProviderOption[];
  chairs: ScheduleChairOption[];
  appointments: Appointment[];
};

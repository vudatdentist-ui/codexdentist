export type DashboardMetric = {
  label: string;
  value: string;
  detail: string | null;
  tone: "blue" | "teal" | "violet" | "green" | "amber" | "rose";
};

export type DashboardFlowStep = {
  key: string;
  label: string;
  count: number;
};

export type DashboardClinicSummary = {
  clinicId: string;
  chainId: string | null;
  chainName: string | null;
  name: string;
  city: string;
  chairs: number;
  providers: number;
  todayAppointments: number;
  inChair: number;
  completed: number;
  utilization: number;
  collectedToday: number;
};

export type DashboardRiskSignal = {
  label: string;
  value: string;
  detail: string;
  tone: "blue" | "teal" | "violet" | "green" | "amber" | "rose";
  href: string;
};

export type DashboardProviderLoad = {
  providerId: string;
  name: string;
  role: string;
  appointmentCount: number;
  activeCount: number;
};

export type DashboardAppointmentSummary = {
  id: string;
  clinicId: string;
  time: string;
  patientName: string;
  providerName: string;
  clinicName: string;
  procedure: string;
  status: string;
};

export type DashboardWorkspace = {
  source: "database" | "demo";
  message: string | null;
  generatedAt: string;
  metrics: DashboardMetric[];
  flow: DashboardFlowStep[];
  clinicSummaries: DashboardClinicSummary[];
  risks: DashboardRiskSignal[];
  providerLoads: DashboardProviderLoad[];
  appointments: DashboardAppointmentSummary[];
};

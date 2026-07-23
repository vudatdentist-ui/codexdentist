export type ClinicReport = {
  clinicId: string;
  chainId: string | null;
  chainName: string | null;
  name: string;
  city: string;
  todayVisits: number;
  production: number;
  collection: number;
  openBalance: number;
  overdueInvoices: number;
  consentRenewals: number;
  patientCount?: number;
  newPatients?: number;
  collectionRatio?: number;
};

export type ReportSignal = {
  title: string;
  value: string;
  detail?: string | null;
};

export type ReportSummary = {
  production: number;
  collection: number;
  openBalance: number;
  collectionRatio: number;
  visits: number;
  newPatients: number;
  overdueInvoices: number;
};

export type ReportTrendPoint = {
  label: string;
  visits: number;
  production: number;
  collection: number;
};

export type ReportAgingBucket = {
  label: string;
  amount: number;
  count: number;
};

export type ReportServiceMixItem = {
  label: string;
  serviceCode: string | null;
  quantity: number;
  production: number;
  collected: number;
};

export type ReportProviderPerformance = {
  providerId: string;
  name: string;
  role: string;
  visits: number;
  completed: number;
};

export type ReportPatientSourceMixItem = {
  source: string;
  patientCount: number;
  newPatientCount: number;
  production: number;
  collection: number;
  manualCost: number;
  roiPercent: number | null;
  commissionDue: number;
};

export type ReportsWorkspace = {
  source: "database" | "demo";
  message: string | null;
  generatedAt: string;
  periodLabel: string;
  filters: {
    from: string;
    to: string;
    clinicId: string | null;
  };
  summary: ReportSummary;
  clinicReports: ClinicReport[];
  signals: ReportSignal[];
  trend: ReportTrendPoint[];
  aging: ReportAgingBucket[];
  serviceMix: ReportServiceMixItem[];
  providerPerformance: ReportProviderPerformance[];
  patientSourceMix: ReportPatientSourceMixItem[];
};

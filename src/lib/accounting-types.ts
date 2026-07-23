export type AccountingKind = "INCOME" | "EXPENSE" | "TRANSFER";

export type AccountingCategorySummary = {
  id: string;
  code: string;
  name: string;
  nameEn: string | null;
  kind: AccountingKind;
  targetPercent: number | null;
  warningPercent: number | null;
  sortOrder: number;
  active: boolean;
};

export type AccountingEntrySummary = {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  kind: AccountingKind;
  amount: number;
  occurredAt: string;
  occurredAtIso: string;
  vendor: string | null;
  description: string;
  paymentMethod: string | null;
  reference: string | null;
  attachmentFileName: string | null;
  attachmentMimeType: string | null;
  attachmentSizeBytes: number | null;
  attachmentUrl: string | null;
  attachmentThumbnailUrl: string | null;
  sourceType: string;
  sourceId: string | null;
  locked: boolean;
};

export type AccountingBudgetTargetSummary = {
  id: string;
  clinicId: string | null;
  categoryId: string;
  periodMonth: string;
  targetPercent: number;
  warningPercent: number | null;
};

export type AccountingPnLLine = {
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  kind: AccountingKind;
  amount: number;
  percentOfCollections: number;
  targetPercent: number | null;
  warningPercent: number | null;
  status: "OK" | "WATCH" | "OVER" | "INFO";
};

export type AccountingSummary = {
  periodMonth: string;
  collections: number;
  manualIncome: number;
  totalIncome: number;
  totalExpenses: number;
  operatingProfit: number;
  profitPercent: number;
  expensePercent: number;
  clinicalPayrollPercent: number;
  opsPayrollPercent: number;
  marketingPercent: number;
  labAndSuppliesPercent: number;
};

export type AccountingAiRunSummary = {
  id: string;
  action: string;
  status: string;
  model: string;
  createdAt: string;
  completedAt: string | null;
  output: unknown;
  rawOutput: string | null;
  error: string | null;
  totalTokens: number | null;
};

export type AccountingWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  generatedAt: string;
  periodMonth: string;
  categories: AccountingCategorySummary[];
  entries: AccountingEntrySummary[];
  budgetTargets: AccountingBudgetTargetSummary[];
  pnlLines: AccountingPnLLine[];
  summary: AccountingSummary;
  aiRuns: AccountingAiRunSummary[];
};

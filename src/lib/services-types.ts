import type { DentalServiceCategory } from "@/lib/service-catalog";

export type ServiceCategorySummary = {
  id: string;
  code: DentalServiceCategory;
  name: string;
  nameEn: string | null;
  active: boolean;
  sortOrder: number;
};

export type ServiceStepSummary = {
  id: string;
  sequence: number;
  name: string;
  description: string | null;
  defaultProgress: number | null;
  expectedMinutes: number | null;
};

export type ServicePriceSummary = {
  id: string;
  price: number;
  currency: string;
  active: boolean;
  effectiveFrom: string;
};

export type ServiceMaterialSummary = {
  id: string;
  inventoryItemId: string | null;
  itemCode: string | null;
  name: string;
  quantity: number | null;
  unit: string | null;
  required: boolean;
  note: string | null;
};

export type ServiceInventoryItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  onHandQuantity: number;
};

export type ServiceCompensationPolicySummary = {
  id: string;
  code: string;
  name: string;
  version: string;
  active: boolean;
  doctorPoolPercent: number;
  assistantPoolPercent: number;
  consultantSharePercent: number;
  operatorSharePercent: number;
  clinicalSupportSharePercent: number;
  assistantPrimarySharePercent: number;
  assistantSecondarySharePercent: number;
};

export type ServiceCatalogSummary = {
  id: string;
  code: string;
  categoryCode: DentalServiceCategory;
  categoryName: string;
  name: string;
  nameEn: string | null;
  status: "DRAFT" | "ACTIVE" | "RETIRED";
  defaultPrice: number;
  defaultDurationMinutes: number | null;
  targetMode: string;
  defaultCompensationRuleId: string | null;
  defaultCompensationRuleName: string | null;
  steps: ServiceStepSummary[];
  prices: ServicePriceSummary[];
  materials: ServiceMaterialSummary[];
};

export type TreatmentServiceSummary = {
  id: string;
  clinicId: string;
  patientId: string;
  serviceCatalogItemId: string | null;
  serviceCode: string;
  catalogCode: string;
  serviceName: string;
  targetSummary: string | null;
  teeth: string[];
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  listPrice: number;
  finalPrice: number;
  currentProgressPercent: number;
  currentStepSequence: number | null;
  collectedAmount: number;
  creditAllocatedAmount: number;
  invoicedAmount: number;
  invoiceNos: string[];
  compensationRuleId: string | null;
  compensationRuleCode: string | null;
  compensationRuleName: string | null;
  compensationRuleVersion: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  steps: ServiceStepSummary[];
  progressEvents: Array<{
    id: string;
    fromProgressPercent: number;
    toProgressPercent: number;
    progressDeltaPercent: number;
    consultantName: string | null;
    performedByName: string;
    clinicalSupportName: string | null;
    assistantPrimaryName: string | null;
    assistantSecondaryName: string | null;
    note: string | null;
    occurredAt: string;
    occurredAtIso: string;
    totalCompensationAmount: number;
  }>;
};

export type ServicesWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  canDelete: boolean;
  message: string | null;
  categories: ServiceCategorySummary[];
  policies: ServiceCompensationPolicySummary[];
  inventoryItems: ServiceInventoryItemOption[];
  services: ServiceCatalogSummary[];
  treatmentServices: TreatmentServiceSummary[];
};

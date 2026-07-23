import type { AppRole } from "@/lib/permissions";
import type {
  SourceCommissionAccrualSummary,
  SourceCommissionPolicySummary,
} from "@/lib/source-commission";

export type SettingsClinicOption = {
  id: string;
  organizationId: string;
  organizationName: string;
  chainId: string | null;
  chainName: string | null;
  name: string;
  city: string;
  address: string;
  phone: string | null;
  active: boolean;
  chairs: SettingsChairOption[];
};

export type SettingsChairOption = {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  active: boolean;
  operationalStatus: "READY" | "BUSY";
};

export type SettingsChainOption = {
  id: string;
  ownerId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  name: string;
  legalName: string | null;
  brandName: string | null;
  taxCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  specialty: string;
  active: boolean;
  clinicCount: number;
};

export type SettingsOrganizationOption = {
  id: string;
  name: string;
  slug: string | null;
  primaryDomain: string | null;
  ownerCount: number;
  clinicCount: number;
  userCount: number;
  createdAt: string;
};

export type StaffMember = {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: AppRole;
  roleAssignments: StaffRoleAssignment[];
  active: boolean;
  staffProfileId: string | null;
  employeeCode: string | null;
  title: string | null;
  department: string | null;
  contractType: string | null;
  baseSalary: string | null;
  commissionRate: string | null;
  hireDate: string | null;
  hireDateIso: string | null;
  dateOfBirth: string | null;
  dateOfBirthIso: string | null;
  gender: string | null;
  primaryClinicId: string | null;
  avatarUrl: string | null;
  canCreatePasswordSetup: boolean;
  mustChangePassword: boolean;
  passwordChangedAt: string | null;
  hasPendingPasswordSetup: boolean;
  clinics: SettingsClinicOption[];
  lastLoginAt: string | null;
};

export type StaffRoleAssignment = {
  id: string;
  role: AppRole;
  clinicId: string | null;
  clinicName: string | null;
  scope: "GLOBAL" | "CLINIC";
  active: boolean;
};

export type AuditLogSummary = {
  id: string;
  actor: string;
  action: string;
  entityType: string;
  createdAt: string;
};

export type ArchivedClinicSummary = {
  clinicId: string;
  organizationId: string;
  organizationName: string;
  name: string;
  city: string;
  patientCount: number;
  appointmentCount: number;
  invoiceCount: number;
  receiptCount: number;
  staffCount: number;
  latestActivityAt: string | null;
};

export type AiRunSummary = {
  id: string;
  module: string;
  action: string;
  provider: string;
  model: string;
  status: string;
  actor: string | null;
  totalTokens: number | null;
  error: string | null;
  createdAt: string;
};

export type SettingsWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  canManageSystems: boolean;
  message: string | null;
  chains: SettingsChainOption[];
  organizations: SettingsOrganizationOption[];
  clinics: SettingsClinicOption[];
  staff: StaffMember[];
  archivedClinics: ArchivedClinicSummary[];
  auditLogs: AuditLogSummary[];
  notificationSettings: {
    deliveryMode: string;
    resendFromEmail: string | null;
    recentFailed: number;
    recentSent: number;
  };
  aiSettings: {
    baseUrlConfigured: boolean;
    enabled: boolean;
    error: string | null;
    model: string;
    provider: string;
  };
  sourceCommission: {
    policies: SourceCommissionPolicySummary[];
    accruals: SourceCommissionAccrualSummary[];
  };
  aiRuns: AiRunSummary[];
};

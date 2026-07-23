import type { AppRole } from "@/lib/permissions";

export type PayrollStaffSummary = {
  id: string;
  userId: string;
  employeeCode: string;
  fullName: string;
  role: AppRole;
  clinicId: string | null;
  clinicName: string | null;
  baseSalary: number | null;
  active: boolean;
};

export type CompensationAccrualSummary = {
  id: string;
  clinicId: string;
  status: "EARNED" | "APPROVED" | "PAID" | "VOID";
  patientName: string;
  serviceCode: string;
  serviceName: string;
  serviceAmount: number;
  earnedProgressPercent: number;
  doctorPoolAmount: number;
  assistantPoolAmount: number;
  totalAmount: number;
  ruleName: string | null;
  createdAt: string;
  createdAtIso: string;
  lines: Array<{
    id: string;
    userId: string;
    userName: string;
    pool: "DOCTOR" | "ASSISTANT";
    role: string;
    amount: number;
    payrollLineId: string | null;
  }>;
};

export type PayrollRunSummary = {
  id: string;
  clinicId: string | null;
  status: "DRAFT" | "APPROVED" | "PAID" | "VOID";
  clinicName: string | null;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  lineCount: number;
  generatedAt: string;
  approvedAt: string | null;
  paidAt: string | null;
};

export type PayrollPolicySummary = {
  id: string;
  clinicId: string | null;
  clinicName: string | null;
  scopeKey: string;
  name: string;
  includeBaseSalary: boolean;
  standardWorkdays: number;
  taxPercent: number;
  insurancePercent: number;
  otherDeductionAmount: number;
  roleOverridesJson: string | null;
  staffOverridesJson: string | null;
  active: boolean;
};

export type StaffShiftSummary = {
  id: string;
  staffProfileId: string;
  staffName: string;
  clinicId: string;
  clinicName: string;
  status: "SCHEDULED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
  roleOnShift: string | null;
  startsAt: string;
  startsAtIso: string;
  endsAt: string;
  endsAtIso: string;
  notes: string | null;
};

export type AttendanceLogSummary = {
  id: string;
  staffProfileId: string;
  staffName: string;
  clinicId: string;
  clinicName: string;
  clockInAt: string;
  clockInAtIso: string;
  clockOutAt: string | null;
  clockOutAtIso: string | null;
  outStatus: string | null;
  note: string | null;
};

export type LeaveRequestSummary = {
  id: string;
  staffProfileId: string;
  staffName: string;
  clinicId: string | null;
  clinicName: string | null;
  leaveType: string;
  status: "REQUESTED" | "APPROVED" | "REJECTED" | "CANCELLED";
  startsAt: string;
  startsAtIso: string;
  endsAt: string;
  endsAtIso: string;
  hours: number | null;
  reason: string | null;
  decisionNote: string | null;
};

export type StaffPayrollWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  staff: PayrollStaffSummary[];
  accruals: CompensationAccrualSummary[];
  payrollRuns: PayrollRunSummary[];
  payrollPolicies: PayrollPolicySummary[];
  shifts: StaffShiftSummary[];
  attendanceLogs: AttendanceLogSummary[];
  leaveRequests: LeaveRequestSummary[];
};

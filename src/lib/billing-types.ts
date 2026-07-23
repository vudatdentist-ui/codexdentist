import type { Invoice } from "@/lib/data";

export type BillingPatientOption = {
  id: string;
  name: string;
  clinicId: string;
};

export type BillingTreatmentServiceSummary = {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  serviceCode: string;
  catalogCode: string;
  serviceName: string;
  targetSummary: string | null;
  teeth: string[];
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  finalPrice: number;
  currentProgressPercent: number;
  collectedAmount: number;
  creditAllocatedAmount: number;
  invoicedAmount: number;
  invoiceNos: string[];
  createdAt: string;
};

export type BillingReceiptSummary = {
  id: string;
  receiptNo: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  amount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  method: string;
  reference: string | null;
  receivedAt: string;
  receivedAtIso: string;
};

export type BillingCreditBalanceSummary = {
  patientId: string;
  clinicId: string;
  amount: number;
};

export type BillingStatementLineSummary = {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  date: string;
  kind: "INVOICE" | "PAYMENT" | "RECEIPT" | "CREDIT_BALANCE" | "SERVICE_CHARGE";
  description: string;
  debit: number;
  credit: number;
  balanceAfter: number;
};

export type BillingPaymentPlanReminderSummary = {
  id: string;
  patientId: string | null;
  patientName: string | null;
  clinicId: string | null;
  recipient: string;
  subject: string | null;
  body: string;
  scheduledAt: string | null;
  status: "DRAFT" | "SCHEDULED" | "SENT" | "FAILED" | "CANCELLED";
  amount: number | null;
};

export type BillingPaymentPlanInstallmentSummary = {
  id: string;
  sequence: number;
  amount: number;
  dueAt: string;
  status: string;
  paidAt: string | null;
};

export type BillingPaymentPlanSummary = {
  id: string;
  planNo: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  status: string;
  totalAmount: number;
  note: string | null;
  createdAt: string;
  installments: BillingPaymentPlanInstallmentSummary[];
};

export type PrintableInvoiceItem = {
  description: string;
  serviceCode: string | null;
  amount: number;
};

export type BillingWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patients: BillingPatientOption[];
  invoices: Invoice[];
  treatmentServices: BillingTreatmentServiceSummary[];
  receipts: BillingReceiptSummary[];
  creditBalances: BillingCreditBalanceSummary[];
  statementLines: BillingStatementLineSummary[];
  paymentPlanReminders: BillingPaymentPlanReminderSummary[];
  paymentPlans: BillingPaymentPlanSummary[];
};

export type PrintablePayment = {
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
};

export type PrintableInvoice = Invoice & {
  source: "database" | "demo";
  organizationName: string;
  clinicName: string;
  clinicCity: string;
  patientPhone: string | null;
  patientEmail: string | null;
  issuedAt: string;
  items: PrintableInvoiceItem[];
  payments: PrintablePayment[];
};

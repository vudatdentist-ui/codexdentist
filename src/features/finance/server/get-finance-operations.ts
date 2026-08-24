import "server-only";

import { emptyEInvoiceState, loadEInvoiceStates, type EInvoiceStateSnapshot } from "@/features/einvoice/server/state";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

export type FinanceIssueKind =
  | "einvoice_failed"
  | "einvoice_stale"
  | "einvoice_void_mismatch"
  | "einvoice_cancel_mismatch"
  | "einvoice_amount_mismatch"
  | "einvoice_external_duplicate"
  | "receipt_unallocated"
  | "receipt_reconciliation"
  | "service_uninvoiced"
  | "invoice_item_mismatch"
  | "invoice_payment_mismatch";

export type FinanceOperationsIssue = {
  id: string;
  kind: FinanceIssueKind;
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
  clinicName: string | null;
  patientId: string | null;
  patientName: string | null;
  dueAt: string | null;
  href: string;
  status: string;
};

export type FinanceInvoiceRow = {
  id: string;
  invoiceNo: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicName: string;
  amount: number;
  paidAmount: number;
  balance: number;
  itemTotal: number;
  paymentTotal: number;
  status: string;
  dueAt: string;
  dueAtIso: string;
  createdAt: string;
  createdAtIso: string;
  treatmentServiceId: string | null;
  treatmentServiceCode: string | null;
  eInvoice: EInvoiceStateSnapshot;
  reconciliation: "MATCHED" | "NEEDS_ACTION" | "MISMATCH";
};

export type FinanceReceiptRow = {
  id: string;
  receiptNo: string;
  patientId: string;
  patientName: string;
  clinicName: string;
  amount: number;
  allocatedAmount: number;
  allocationRowTotal: number;
  unallocatedAmount: number;
  method: string;
  reference: string | null;
  receivedAt: string;
  receivedAtIso: string;
};

export type FinanceServiceRow = {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  clinicName: string;
  serviceCode: string;
  serviceName: string;
  status: string;
  progressPercent: number;
  finalPrice: number;
  collectedAmount: number;
  invoicedAmount: number;
  remainingCollectionAmount: number;
  uninvoicedCollectedAmount: number;
};

export type FinanceOperationsModel = {
  source: "database" | "demo";
  message: string | null;
  canManageInvoice: boolean;
  invoices: FinanceInvoiceRow[];
  receipts: FinanceReceiptRow[];
  services: FinanceServiceRow[];
  issues: FinanceOperationsIssue[];
  summary: {
    collectionsToday: number;
    outstandingBalance: number;
    unallocatedReceipts: number;
    uninvoicedCollections: number;
    eInvoiceFailed: number;
    eInvoicePending: number;
  };
};

const financeRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "BILLING"];
const moneyTolerance = 0.5;
const staleEInvoiceMs = 30 * 60 * 1000;

export function canAccessFinanceOperations(session: AppSession) {
  return hasAnyRole(session, financeRoles);
}

export async function getFinanceOperations(
  session: AppSession,
): Promise<FinanceOperationsModel> {
  try {
    const clinicIds = allowedClinicIds(session);
    const [invoices, receipts, services] = await Promise.all([
      prisma.invoice.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
        },
        include: {
          clinic: { select: { name: true } },
          patient: { select: { id: true, fullName: true } },
          items: {
            include: {
              treatmentService: { select: { id: true, serviceCode: true } },
            },
            orderBy: { createdAt: "asc" },
          },
          payments: { orderBy: { paidAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        take: 300,
      }),
      prisma.receipt.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
        },
        include: {
          clinic: { select: { name: true } },
          patient: { select: { id: true, fullName: true } },
          allocations: { select: { amount: true } },
        },
        orderBy: { receivedAt: "desc" },
        take: 300,
      }),
      prisma.treatmentService.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: { in: clinicIds },
          status: { not: "CANCELLED" },
        },
        include: {
          clinic: { select: { name: true } },
          patient: { select: { id: true, fullName: true } },
          receiptAllocations: { select: { amount: true } },
          invoiceItems: {
            include: { invoice: { select: { status: true } } },
          },
        },
        orderBy: { updatedAt: "desc" },
        take: 400,
      }),
    ]);

    const stateMap = await loadEInvoiceStates(session, invoices.map((invoice) => invoice.id));
    const invoiceRows: FinanceInvoiceRow[] = invoices.map((invoice) => {
      const itemTotal = sum(invoice.items.map((item) => Number(item.amount)));
      const paymentTotal = sum(invoice.payments.map((payment) => Number(payment.amount)));
      const eInvoice = stateMap.get(invoice.id) ?? emptyEInvoiceState(invoice.id);
      const amount = Number(invoice.amount);
      const paidAmount = Number(invoice.paidAmount);
      const itemMismatch = invoice.status !== "VOID" && differentMoney(itemTotal, amount);
      const paymentMismatch = invoice.status !== "VOID" && differentMoney(paymentTotal, paidAmount);
      const externalActiveOnVoid =
        invoice.status === "VOID" &&
        (eInvoice.state === "ISSUED" || eInvoice.state === "REPLACED");
      const externalCancelledOnActive =
        invoice.status !== "VOID" && eInvoice.state === "CANCELLED";
      const eInvoiceAmountMismatch =
        (eInvoice.state === "ISSUED" || eInvoice.state === "REPLACED") &&
        eInvoice.amountSnapshot != null &&
        differentMoney(eInvoice.amountSnapshot, amount);
      const needsAction = eInvoice.state === "FAILED" || eInvoice.state === "PENDING";
      const serviceItem = invoice.items.find((item) => item.treatmentService);

      return {
        id: invoice.id,
        invoiceNo: invoice.invoiceNo,
        patientId: invoice.patient.id,
        patientName: invoice.patient.fullName,
        clinicId: invoice.clinicId,
        clinicName: invoice.clinic.name,
        amount,
        paidAmount,
        balance: Math.max(amount - paidAmount, 0),
        itemTotal,
        paymentTotal,
        status: invoice.status,
        dueAt: vietnamDate(invoice.dueDate),
        dueAtIso: invoice.dueDate.toISOString(),
        createdAt: vietnamDateTime(invoice.createdAt),
        createdAtIso: invoice.createdAt.toISOString(),
        treatmentServiceId: serviceItem?.treatmentService?.id ?? null,
        treatmentServiceCode: serviceItem?.treatmentService?.serviceCode ?? null,
        eInvoice,
        reconciliation:
          itemMismatch ||
          paymentMismatch ||
          externalActiveOnVoid ||
          externalCancelledOnActive ||
          eInvoiceAmountMismatch
            ? "MISMATCH"
            : needsAction
              ? "NEEDS_ACTION"
              : "MATCHED",
      };
    });

    const receiptRows: FinanceReceiptRow[] = receipts.map((receipt) => ({
      id: receipt.id,
      receiptNo: receipt.receiptNo,
      patientId: receipt.patient.id,
      patientName: receipt.patient.fullName,
      clinicName: receipt.clinic.name,
      amount: Number(receipt.amount),
      allocatedAmount: Number(receipt.allocatedAmount),
      allocationRowTotal: sum(receipt.allocations.map((allocation) => Number(allocation.amount))),
      unallocatedAmount: Number(receipt.unallocatedAmount),
      method: receipt.method,
      reference: receipt.reference,
      receivedAt: vietnamDateTime(receipt.receivedAt),
      receivedAtIso: receipt.receivedAt.toISOString(),
    }));

    const serviceRows: FinanceServiceRow[] = services.map((service) => {
      const finalPrice = Number(service.finalPrice);
      const collectedAmount = sum(service.receiptAllocations.map((allocation) => Number(allocation.amount)));
      const invoicedAmount = sum(
        service.invoiceItems
          .filter((item) => item.invoice.status !== "VOID")
          .map((item) => Number(item.amount)),
      );

      return {
        id: service.id,
        patientId: service.patient.id,
        patientName: service.patient.fullName,
        clinicId: service.clinicId,
        clinicName: service.clinic.name,
        serviceCode: service.serviceCode,
        serviceName: service.serviceName,
        status: service.status,
        progressPercent: Number(service.currentProgressPercent),
        finalPrice,
        collectedAmount,
        invoicedAmount,
        remainingCollectionAmount: Math.max(finalPrice - collectedAmount, 0),
        uninvoicedCollectedAmount: Math.max(collectedAmount - invoicedAmount, 0),
      };
    });

    const issues = deriveIssues(invoiceRows, receiptRows, serviceRows);
    const todayKey = vietnamDateKey(new Date());

    return {
      source: "database",
      message: null,
      canManageInvoice: canAccessFinanceOperations(session),
      invoices: invoiceRows,
      receipts: receiptRows,
      services: serviceRows,
      issues,
      summary: {
        collectionsToday: sum(
          receiptRows
            .filter((receipt) => vietnamDateKey(new Date(receipt.receivedAtIso)) === todayKey)
            .map((receipt) => receipt.amount),
        ),
        outstandingBalance: sum(
          invoiceRows.filter((invoice) => invoice.status !== "VOID").map((invoice) => invoice.balance),
        ),
        unallocatedReceipts: sum(receiptRows.map((receipt) => receipt.unallocatedAmount)),
        uninvoicedCollections: sum(serviceRows.map((service) => service.uninvoicedCollectedAmount)),
        eInvoiceFailed: invoiceRows.filter((invoice) => invoice.eInvoice.state === "FAILED").length,
        eInvoicePending: invoiceRows.filter((invoice) => invoice.eInvoice.state === "PENDING").length,
      },
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "finance operations");
    return emptyFinanceOperations();
  }
}

function deriveIssues(
  invoices: FinanceInvoiceRow[],
  receipts: FinanceReceiptRow[],
  services: FinanceServiceRow[],
) {
  const issues: FinanceOperationsIssue[] = [];
  const now = Date.now();
  const activeExternalRefs = new Map<string, FinanceInvoiceRow[]>();

  for (const invoice of invoices) {
    if (
      (invoice.eInvoice.state === "ISSUED" || invoice.eInvoice.state === "REPLACED") &&
      invoice.eInvoice.providerKey &&
      invoice.eInvoice.externalInvoiceId
    ) {
      const key = `${invoice.eInvoice.providerKey}\u0000${invoice.eInvoice.externalInvoiceId}`;
      const rows = activeExternalRefs.get(key) ?? [];
      rows.push(invoice);
      activeExternalRefs.set(key, rows);
    }

    if (invoice.eInvoice.state === "FAILED") {
      issues.push(issue({
        id: `einvoice-failed:${invoice.id}`,
        kind: "einvoice_failed",
        priority: "high",
        title: `HĐĐT lỗi: ${invoice.invoiceNo}`,
        detail: invoice.eInvoice.errorCode
          ? `${invoice.patientName} · ${invoice.eInvoice.errorCode}`
          : invoice.patientName,
        invoice,
        status: "EINVOICE_FAILED",
      }));
    }

    if (
      invoice.eInvoice.state === "PENDING" &&
      invoice.eInvoice.updatedAtMs != null &&
      now - invoice.eInvoice.updatedAtMs > staleEInvoiceMs
    ) {
      issues.push(issue({
        id: `einvoice-stale:${invoice.id}`,
        kind: "einvoice_stale",
        priority: "high",
        title: `HĐĐT chờ quá lâu: ${invoice.invoiceNo}`,
        detail: `${invoice.patientName} · chờ đồng bộ hơn 30 phút`,
        invoice,
        status: "EINVOICE_PENDING_STALE",
      }));
    }

    if (
      invoice.status === "VOID" &&
      (invoice.eInvoice.state === "ISSUED" || invoice.eInvoice.state === "REPLACED")
    ) {
      issues.push(issue({
        id: `einvoice-void:${invoice.id}`,
        kind: "einvoice_void_mismatch",
        priority: "high",
        title: `Hóa đơn đã hủy nhưng HĐĐT còn hiệu lực: ${invoice.invoiceNo}`,
        detail: `${invoice.patientName} · cần đối soát trạng thái ngoài hệ thống`,
        invoice,
        status: "EINVOICE_LOCAL_VOID_EXTERNAL_ACTIVE",
      }));
    }

    if (invoice.status !== "VOID" && invoice.eInvoice.state === "CANCELLED") {
      issues.push(issue({
        id: `einvoice-cancelled-active:${invoice.id}`,
        kind: "einvoice_cancel_mismatch",
        priority: "high",
        title: `HĐĐT đã hủy nhưng hóa đơn nội bộ còn hiệu lực: ${invoice.invoiceNo}`,
        detail: `${invoice.patientName} · cần đối soát trạng thái hóa đơn nội bộ`,
        invoice,
        status: "EINVOICE_EXTERNAL_CANCELLED_LOCAL_ACTIVE",
      }));
    }

    if (
      (invoice.eInvoice.state === "ISSUED" || invoice.eInvoice.state === "REPLACED") &&
      invoice.eInvoice.amountSnapshot != null &&
      differentMoney(invoice.eInvoice.amountSnapshot, invoice.amount)
    ) {
      issues.push(issue({
        id: `einvoice-amount:${invoice.id}`,
        kind: "einvoice_amount_mismatch",
        priority: "high",
        title: `Số tiền HĐĐT lệch hóa đơn: ${invoice.invoiceNo}`,
        detail: `${money(invoice.eInvoice.amountSnapshot)} ↔ ${money(invoice.amount)}`,
        invoice,
        status: "EINVOICE_AMOUNT_MISMATCH",
      }));
    }

    if (invoice.status !== "VOID" && differentMoney(invoice.itemTotal, invoice.amount)) {
      issues.push(issue({
        id: `invoice-items:${invoice.id}`,
        kind: "invoice_item_mismatch",
        priority: "high",
        title: `Chi tiết hóa đơn không khớp: ${invoice.invoiceNo}`,
        detail: `${money(invoice.itemTotal)} chi tiết ↔ ${money(invoice.amount)} tổng`,
        invoice,
        status: "INVOICE_ITEM_MISMATCH",
      }));
    }

    if (invoice.status !== "VOID" && differentMoney(invoice.paymentTotal, invoice.paidAmount)) {
      issues.push(issue({
        id: `invoice-payments:${invoice.id}`,
        kind: "invoice_payment_mismatch",
        priority: "high",
        title: `Thanh toán hóa đơn không khớp: ${invoice.invoiceNo}`,
        detail: `${money(invoice.paymentTotal)} payment ↔ ${money(invoice.paidAmount)} đã thu`,
        invoice,
        status: "INVOICE_PAYMENT_MISMATCH",
      }));
    }
  }

  for (const duplicates of activeExternalRefs.values()) {
    if (duplicates.length < 2) continue;
    for (const invoice of duplicates) {
      issues.push(issue({
        id: `einvoice-duplicate:${invoice.id}`,
        kind: "einvoice_external_duplicate",
        priority: "high",
        title: `Mã HĐĐT đang gắn nhiều hóa đơn: ${invoice.invoiceNo}`,
        detail: `${invoice.eInvoice.externalInvoiceId} · ${duplicates.length} hóa đơn nội bộ`,
        invoice,
        status: "EINVOICE_EXTERNAL_REFERENCE_DUPLICATE",
      }));
    }
  }

  for (const receipt of receipts) {
    if (receipt.unallocatedAmount > moneyTolerance) {
      issues.push({
        id: `receipt-unallocated:${receipt.id}`,
        kind: "receipt_unallocated",
        priority: receipt.unallocatedAmount >= 1_000_000 ? "medium" : "low",
        title: `Phiếu thu chưa phân bổ: ${receipt.receiptNo}`,
        detail: `${receipt.patientName} · còn ${money(receipt.unallocatedAmount)}`,
        clinicName: receipt.clinicName,
        patientId: receipt.patientId,
        patientName: receipt.patientName,
        dueAt: receipt.receivedAtIso,
        href: `/billing?patientId=${encodeURIComponent(receipt.patientId)}`,
        status: "RECEIPT_UNALLOCATED",
      });
    }

    const storedBalanceMismatch = differentMoney(
      receipt.allocatedAmount + receipt.unallocatedAmount,
      receipt.amount,
    );
    const allocationRowsMismatch = differentMoney(
      receipt.allocationRowTotal,
      receipt.allocatedAmount,
    );
    if (storedBalanceMismatch || allocationRowsMismatch) {
      issues.push({
        id: `receipt-reconcile:${receipt.id}`,
        kind: "receipt_reconciliation",
        priority: "high",
        title: `Phiếu thu lệch phân bổ: ${receipt.receiptNo}`,
        detail: `${money(receipt.amount)} thu · ${money(receipt.allocatedAmount)} đã phân bổ · ${money(receipt.allocationRowTotal)} từ allocation rows · ${money(receipt.unallocatedAmount)} dư`,
        clinicName: receipt.clinicName,
        patientId: receipt.patientId,
        patientName: receipt.patientName,
        dueAt: receipt.receivedAtIso,
        href: `/billing?patientId=${encodeURIComponent(receipt.patientId)}`,
        status: "RECEIPT_RECONCILIATION_MISMATCH",
      });
    }
  }

  for (const service of services) {
    if (service.uninvoicedCollectedAmount <= moneyTolerance) continue;
    issues.push({
      id: `service-uninvoiced:${service.id}`,
      kind: "service_uninvoiced",
      priority: service.uninvoicedCollectedAmount >= 1_000_000 ? "medium" : "low",
      title: `Đã thu chưa xuất hóa đơn: ${service.serviceCode}`,
      detail: `${service.patientName} · ${money(service.uninvoicedCollectedAmount)}`,
      clinicName: service.clinicName,
      patientId: service.patientId,
      patientName: service.patientName,
      dueAt: null,
      href: `/patients/${encodeURIComponent(service.patientId)}/treatments/${encodeURIComponent(service.id)}`,
      status: "SERVICE_COLLECTION_UNINVOICED",
    });
  }

  return issues.sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));
}

function issue({
  id,
  kind,
  priority,
  title,
  detail,
  invoice,
  status,
}: {
  id: string;
  kind: FinanceIssueKind;
  priority: FinanceOperationsIssue["priority"];
  title: string;
  detail: string;
  invoice: FinanceInvoiceRow;
  status: string;
}): FinanceOperationsIssue {
  return {
    id,
    kind,
    priority,
    title,
    detail,
    clinicName: invoice.clinicName,
    patientId: invoice.patientId,
    patientName: invoice.patientName,
    dueAt: invoice.eInvoice.updatedAt ?? invoice.createdAtIso,
    href: `/operations/finance#invoice-${encodeURIComponent(invoice.id)}`,
    status,
  };
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) return session.clinicIds;
  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function differentMoney(left: number, right: number) {
  return Math.abs(left - right) > moneyTolerance;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function priorityRank(priority: FinanceOperationsIssue["priority"]) {
  return priority === "high" ? 0 : priority === "medium" ? 1 : 2;
}

function money(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function vietnamDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function emptyFinanceOperations(): FinanceOperationsModel {
  return {
    source: "demo",
    message: "Chưa tải được dữ liệu tài chính. Vui lòng thử lại sau.",
    canManageInvoice: false,
    invoices: [],
    receipts: [],
    services: [],
    issues: [],
    summary: {
      collectionsToday: 0,
      outstandingBalance: 0,
      unallocatedReceipts: 0,
      uninvoicedCollections: 0,
      eInvoiceFailed: 0,
      eInvoicePending: 0,
    },
  };
}

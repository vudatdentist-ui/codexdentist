import "server-only";

import {
  clinics as demoClinics,
  invoices as demoInvoices,
  patients as demoPatients,
  type Invoice,
} from "@/lib/data";
import { patientAccessWhere } from "@/lib/patient-access";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import type {
  BillingReceiptSummary,
  BillingStatementLineSummary,
  BillingTreatmentServiceSummary,
  BillingWorkspace,
  PrintableInvoice,
} from "@/lib/billing-types";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

const mutableBillingRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "FRONT_DESK",
  "BILLING",
];

export async function getBillingWorkspace(
  session: AppSession,
  options: { patientId?: string } = {},
): Promise<BillingWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);

    const [
      dbPatients,
      dbInvoices,
      dbTreatmentServices,
      dbReceipts,
      dbCreditBalances,
      dbPayments,
      dbPaymentPlanReminders,
      dbPaymentPlans,
    ] = await Promise.all([
      prisma.patient.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { id: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          fullName: true,
          clinicId: true,
        },
        orderBy: {
          fullName: "asc",
        },
      }),
      prisma.invoice.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
            ...(options.patientId ? { id: options.patientId } : {}),
          },
        },
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
          items: {
            include: {
              treatmentService: {
                select: {
                  id: true,
                  serviceCode: true,
                },
              },
            },
          },
        },
        orderBy: {
          dueDate: "asc",
        },
      }),
      prisma.treatmentService.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
          serviceCatalogItem: {
            select: {
              code: true,
            },
          },
          receiptAllocations: {
            include: {
              receipt: {
                select: {
                  method: true,
                },
              },
            },
          },
          invoiceItems: {
            include: {
              invoice: {
                select: {
                  invoiceNo: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: [
          {
            createdAt: "asc",
          },
          {
            id: "asc",
          },
        ],
      }),
      prisma.receipt.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
            },
          },
        },
        orderBy: {
          receivedAt: "desc",
        },
        take: 300,
      }),
      prisma.patientCreditBalance.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
      }),
      prisma.payment.findMany({
        where: {
          invoice: {
            ...(options.patientId ? { patientId: options.patientId } : {}),
            clinicId: {
              in: clinicIds,
            },
            patient: {
              organizationId: session.organizationId,
            },
          },
          method: {
            not: "service_receipt",
          },
        },
        include: {
          invoice: {
            include: {
              patient: {
                select: {
                  id: true,
                  fullName: true,
                },
              },
            },
          },
        },
        orderBy: {
          paidAt: "asc",
        },
        take: 400,
      }),
      prisma.notification.findMany({
        where: {
          organizationId: session.organizationId,
          templateKey: {
            in: ["PAYMENT_PLAN", "PAYMENT_REMINDER"],
          },
          status: {
            not: "CANCELLED",
          },
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId: {
                in: clinicIds,
              },
            },
          ],
          ...(options.patientId ? { patientId: options.patientId } : {}),
        },
        include: {
          patient: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          scheduledAt: "asc",
        },
        take: 120,
      }),
      prisma.paymentPlan.findMany({
        where: {
          organizationId: session.organizationId,
          ...(options.patientId ? { patientId: options.patientId } : {}),
          clinicId: {
            in: clinicIds,
          },
        },
        include: {
          patient: {
            select: {
              fullName: true,
            },
          },
          installments: {
            orderBy: {
              sequence: "asc",
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 120,
      }),
    ]);
    const statementLines = buildStatementLines({
      invoices: dbInvoices,
      treatmentServices: dbTreatmentServices,
      receipts: dbReceipts,
      payments: dbPayments,
      creditBalances: dbCreditBalances,
    });
    const receiptNos = new Set(dbReceipts.map((receipt) => receipt.receiptNo));
    const receipts = [
      ...dbReceipts.map(toBillingReceiptSummary),
      ...dbPayments
        .filter(
          (payment) =>
            Number(payment.amount) > 0 &&
            (!payment.reference || !receiptNos.has(payment.reference)),
        )
        .map(toLegacyPaymentReceiptSummary),
    ].sort((left, right) => right.receivedAt.localeCompare(left.receivedAt));

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableBillingRoles) && dbPatients.length > 0,
      message:
        dbPatients.length === 0
          ? "Chưa có dữ liệu trong phạm vi hiện tại."
          : null,
      patients: dbPatients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        clinicId: patient.clinicId,
      })),
      invoices: dbInvoices.map((invoice) => {
        const serviceItem = invoice.items.find((item) => item.treatmentService);

        return {
          id: invoice.invoiceNo,
          patient: invoice.patient.fullName,
          patientId: invoice.patient.id,
          clinicId: invoice.clinicId,
          amount: Number(invoice.amount),
          paidAmount: Number(invoice.paidAmount),
          status: invoiceStatusLabel(invoice.status, invoice.dueDate),
          due: vietnamDate(invoice.dueDate),
          serviceId: serviceItem?.treatmentService?.id,
          serviceCode: serviceItem?.treatmentService?.serviceCode,
          issuedAtMs: invoice.createdAt.getTime(),
        };
      }),
      treatmentServices: dbTreatmentServices.map(toBillingTreatmentServiceSummary),
      receipts,
      creditBalances: dbCreditBalances.map((balance) => ({
        patientId: balance.patientId,
        clinicId: balance.clinicId,
        amount: Number(balance.amount),
      })),
      statementLines,
      paymentPlanReminders: dbPaymentPlanReminders.map((notification) => ({
        id: notification.id,
        patientId: notification.patientId,
        patientName: notification.patient?.fullName ?? null,
        clinicId: notification.clinicId,
        recipient: notification.recipient,
        subject: notification.subject,
        body: notification.body,
        scheduledAt: notification.scheduledAt ? vietnamDate(notification.scheduledAt) : null,
        status: notification.status as BillingWorkspace["paymentPlanReminders"][number]["status"],
        amount: notificationAmount(notification.metadata),
      })),
      paymentPlans: dbPaymentPlans.map((plan) => ({
        id: plan.id,
        planNo: plan.planNo,
        patientId: plan.patientId,
        patientName: plan.patient.fullName,
        clinicId: plan.clinicId,
        status: plan.status,
        totalAmount: Number(plan.totalAmount),
        note: plan.note,
        createdAt: vietnamDate(plan.createdAt),
        installments: plan.installments.map((installment) => ({
          id: installment.id,
          sequence: installment.sequence,
          amount: Number(installment.amount),
          dueAt: vietnamDate(installment.dueAt),
          status: installment.status,
          paidAt: installment.paidAt ? vietnamDate(installment.paidAt) : null,
        })),
      })),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "billing");
    return demoBillingWorkspace(session);
  }
}

export async function getPrintableInvoice(
  session: AppSession,
  invoiceNo: string,
): Promise<PrintableInvoice | null> {
  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        invoiceNo,
        patient: patientAccessWhere(session),
      },
      include: {
        clinic: {
          select: {
            id: true,
            name: true,
            city: true,
          },
        },
        patient: {
          select: {
            id: true,
            organizationId: true,
            fullName: true,
            phone: true,
            email: true,
          },
        },
        payments: {
          orderBy: {
            paidAt: "asc",
          },
        },
        items: {
          include: {
            treatmentService: {
              select: {
                serviceCode: true,
              },
            },
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (
      !invoice ||
      invoice.patient.organizationId !== session.organizationId
    ) {
      return null;
    }

    return {
      source: "database",
      organizationName: session.organizationName,
      id: invoice.invoiceNo,
      patient: invoice.patient.fullName,
      patientId: invoice.patient.id,
      clinicId: invoice.clinicId,
      clinicName: invoice.clinic.name,
      clinicCity: invoice.clinic.city,
      patientPhone: invoice.patient.phone,
      patientEmail: invoice.patient.email,
      amount: Number(invoice.amount),
      paidAmount: Number(invoice.paidAmount),
      status: invoiceStatusLabel(invoice.status, invoice.dueDate),
      due: vietnamDate(invoice.dueDate),
      issuedAt: vietnamDate(invoice.createdAt),
      items: invoice.items.map((item) => ({
        description: item.description,
        serviceCode: item.treatmentService?.serviceCode ?? null,
        amount: Number(item.amount),
      })),
      payments: invoice.payments.map((payment) => ({
        amount: Number(payment.amount),
        method: paymentMethodLabel(payment.method),
        reference: payment.reference,
        paidAt: vietnamDate(payment.paidAt),
      })),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "billing.print");
    return demoPrintableInvoice(session, invoiceNo);
  }
}

function demoBillingWorkspace(session: AppSession): BillingWorkspace {
  const allowedIds = new Set(session.clinicIds);

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    patients: demoPatients
      .filter((patient) => allowedIds.has(patient.clinicId))
      .map((patient) => ({
        id: patient.id,
        name: patient.name,
        clinicId: patient.clinicId,
      })),
    invoices: demoInvoices.filter((invoice) => allowedIds.has(invoice.clinicId)),
    treatmentServices: [],
    receipts: [],
    creditBalances: [],
    statementLines: [],
    paymentPlanReminders: [],
    paymentPlans: [],
  };
}

function demoPrintableInvoice(
  session: AppSession,
  invoiceNo: string,
): PrintableInvoice | null {
  const allowedIds = new Set(session.clinicIds);
  const invoice = demoInvoices.find(
    (candidate) => candidate.id === invoiceNo && allowedIds.has(candidate.clinicId),
  );

  if (!invoice) {
    return null;
  }

  const clinic = demoClinics.find((candidate) => candidate.id === invoice.clinicId);
  const patient = demoPatients.find(
    (candidate) =>
      candidate.id === invoice.patientId ||
      (candidate.name === invoice.patient && candidate.clinicId === invoice.clinicId),
  );
  const paidAmount =
    invoice.paidAmount ?? (invoice.status === "Paid" ? invoice.amount : 0);

  return {
    ...invoice,
    source: "demo",
    organizationName: session.organizationName,
    clinicName: clinic?.name ?? "Codexdentist Clinic",
    clinicCity: clinic?.city ?? "Viet Nam",
    patientPhone: patient?.phone ?? null,
    patientEmail: patient?.email ?? null,
    paidAmount,
    issuedAt: invoice.due,
    items: [
      {
        description: "Dental services and treatment charges",
        serviceCode: null,
        amount: invoice.amount,
      },
    ],
    payments:
      paidAmount > 0
        ? [
            {
              amount: paidAmount,
              method: "Demo payment",
              reference: null,
              paidAt: invoice.due,
            },
          ]
        : [],
  };
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId
    ? [session.activeClinicId]
    : session.clinicIds;
}

function invoiceStatusLabel(status: string, dueDate: Date): Invoice["status"] {
  if (status !== "PAID" && status !== "VOID" && dueDate < new Date()) {
    return "Overdue";
  }

  const labels: Record<string, Invoice["status"]> = {
    DRAFT: "Draft",
    OPEN: "Open",
    PARTIAL: "Partial",
    PAID: "Paid",
    OVERDUE: "Overdue",
    VOID: "Void",
  };

  return labels[status] ?? "Open";
}

function toBillingTreatmentServiceSummary(service: {
  id: string;
  patientId: string;
  patient: {
    fullName: string;
  };
  clinicId: string;
  serviceCode: string;
  serviceName: string;
  targetSummary: string | null;
  teeth: string[];
  status: string;
  finalPrice: unknown;
  currentProgressPercent: unknown;
  createdAt: Date;
  serviceCatalogItem: {
    code: string;
  } | null;
  receiptAllocations: Array<{
    amount: unknown;
    receipt: {
      method: string;
    };
  }>;
  invoiceItems: Array<{
    amount: unknown;
    invoice: {
      invoiceNo: string;
      status: string;
    };
  }>;
}): BillingTreatmentServiceSummary {
  const activeInvoiceItems = service.invoiceItems.filter(
    (item) => item.invoice.status !== "VOID",
  );

  return {
    id: service.id,
    patientId: service.patientId,
    patientName: service.patient.fullName,
    clinicId: service.clinicId,
    serviceCode: service.serviceCode,
    catalogCode: service.serviceCatalogItem?.code ?? service.serviceCode,
    serviceName: service.serviceName,
    targetSummary: service.targetSummary,
    teeth: service.teeth,
    status: service.status as BillingTreatmentServiceSummary["status"],
    finalPrice: Number(service.finalPrice),
    currentProgressPercent: Number(service.currentProgressPercent),
    collectedAmount: sumAmounts(
      service.receiptAllocations.filter(
        (allocation) => allocation.receipt.method !== "credit_balance",
      ),
    ),
    creditAllocatedAmount: sumAmounts(
      service.receiptAllocations.filter(
        (allocation) => allocation.receipt.method === "credit_balance",
      ),
    ),
    invoicedAmount: sumAmounts(activeInvoiceItems),
    invoiceNos: Array.from(
      new Set(activeInvoiceItems.map((item) => item.invoice.invoiceNo)),
    ),
    createdAt: vietnamDate(service.createdAt),
  };
}

function toBillingReceiptSummary(receipt: {
  id: string;
  receiptNo: string;
  patientId: string;
  patient: {
    fullName: string;
  };
  clinicId: string;
  amount: unknown;
  allocatedAmount: unknown;
  unallocatedAmount: unknown;
  method: string;
  reference: string | null;
  receivedAt: Date;
}): BillingReceiptSummary {
  return {
    id: receipt.id,
    receiptNo: receipt.receiptNo,
    patientId: receipt.patientId,
    patientName: receipt.patient.fullName,
    clinicId: receipt.clinicId,
    amount: Number(receipt.amount),
    allocatedAmount: Number(receipt.allocatedAmount),
    unallocatedAmount: Number(receipt.unallocatedAmount),
    method: receipt.method,
    reference: receipt.reference,
    receivedAt: vietnamDate(receipt.receivedAt),
    receivedAtIso: receipt.receivedAt.toISOString(),
  };
}

function toLegacyPaymentReceiptSummary(payment: {
  id: string;
  amount: unknown;
  method: string;
  reference: string | null;
  paidAt: Date;
  invoice: {
    invoiceNo: string;
    patientId: string;
    clinicId: string;
    patient: {
      fullName: string;
    };
  };
}): BillingReceiptSummary {
  const amount = Number(payment.amount);

  return {
    id: `legacy-payment-${payment.id}`,
    receiptNo: `PMT-${payment.invoice.invoiceNo}-${payment.id.slice(-6).toUpperCase()}`,
    patientId: payment.invoice.patientId,
    patientName: payment.invoice.patient.fullName,
    clinicId: payment.invoice.clinicId,
    amount,
    allocatedAmount: amount,
    unallocatedAmount: 0,
    method: payment.method,
    reference: payment.reference ?? payment.invoice.invoiceNo,
    receivedAt: vietnamDate(payment.paidAt),
    receivedAtIso: payment.paidAt.toISOString(),
  };
}

function sumAmounts(items: Array<{ amount: unknown }>) {
  return items.reduce((total, item) => total + Number(item.amount), 0);
}

function buildStatementLines(input: {
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    patientId: string;
    patient: {
      fullName: string;
    };
    clinicId: string;
    amount: unknown;
    createdAt: Date;
  }>;
  treatmentServices: Array<{
    id: string;
    serviceCode: string;
    serviceName: string;
    patientId: string;
    clinicId: string;
    finalPrice: unknown;
    currentProgressPercent: unknown;
    createdAt: Date;
    patient: {
      fullName: string;
    };
    receiptAllocations: Array<{
      amount: unknown;
    }>;
    invoiceItems: Array<{
      amount: unknown;
      invoice: {
        status: string;
      };
    }>;
  }>;
  receipts: Array<{
    id: string;
    receiptNo: string;
    patientId: string;
    patient: {
      fullName: string;
    };
    clinicId: string;
    amount: unknown;
    method: string;
    receivedAt: Date;
  }>;
  payments: Array<{
    id: string;
    amount: unknown;
    method: string;
    reference: string | null;
    paidAt: Date;
    invoice: {
      invoiceNo: string;
      patientId: string;
      clinicId: string;
      patient: {
        id: string;
        fullName: string;
      };
    };
  }>;
  creditBalances: Array<{
    id: string;
    patientId: string;
    clinicId: string;
    amount: unknown;
  }>;
}): BillingStatementLineSummary[] {
  const receiptNos = new Set(input.receipts.map((receipt) => receipt.receiptNo));
  const invoicedServiceIds = new Set(
    input.treatmentServices
      .filter((service) =>
        service.invoiceItems.some((item) => item.invoice.status !== "VOID"),
      )
      .map((service) => service.id),
  );
  const rawLines = [
    ...input.invoices
      .filter((invoice) => invoice.status !== "VOID")
      .map((invoice) => ({
        id: `invoice-${invoice.id}`,
        patientId: invoice.patientId,
        patientName: invoice.patient.fullName,
        clinicId: invoice.clinicId,
        occurredAt: invoice.createdAt,
        kind: "INVOICE" as const,
        description: invoice.invoiceNo,
        debit: Number(invoice.amount),
        credit: 0,
      })),
    ...input.treatmentServices
      .filter((service) => {
        const appliedAmount = sumAmounts(service.receiptAllocations);

        return (
          !invoicedServiceIds.has(service.id) &&
          (appliedAmount > 0 || Number(service.currentProgressPercent) > 0)
        );
      })
      .map((service) => ({
        id: `service-charge-${service.id}`,
        patientId: service.patientId,
        patientName: service.patient.fullName,
        clinicId: service.clinicId,
        occurredAt: service.createdAt,
        kind: "SERVICE_CHARGE" as const,
        description: `${service.serviceCode} · ${service.serviceName}`,
        debit: Number(service.finalPrice),
        credit: 0,
      })),
    ...input.receipts
      .filter(
        (receipt) =>
          Number(receipt.amount) > 0 && receipt.method !== "credit_balance",
      )
      .map((receipt) => ({
        id: `receipt-${receipt.id}`,
        patientId: receipt.patientId,
        patientName: receipt.patient.fullName,
        clinicId: receipt.clinicId,
        occurredAt: receipt.receivedAt,
        kind: "RECEIPT" as const,
        description: receipt.receiptNo,
        debit: 0,
        credit: Number(receipt.amount),
      })),
    ...input.payments
      .filter((payment) => !payment.reference || !receiptNos.has(payment.reference))
      .map((payment) => {
      const amount = Number(payment.amount);

      return {
        id: `payment-${payment.id}`,
        patientId: payment.invoice.patientId,
        patientName: payment.invoice.patient.fullName,
        clinicId: payment.invoice.clinicId,
        occurredAt: payment.paidAt,
        kind: "PAYMENT" as const,
        description: `${payment.invoice.invoiceNo} · ${payment.method}`,
        debit: amount < 0 ? Math.abs(amount) : 0,
        credit: amount > 0 ? amount : 0,
      };
    }),
  ].sort((left, right) => {
    const patientDelta = left.patientId.localeCompare(right.patientId);

    if (patientDelta !== 0) {
      return patientDelta;
    }

    return left.occurredAt.getTime() - right.occurredAt.getTime();
  });
  const balanceByPatient = new Map<string, number>();

  return rawLines.map((line) => {
    const nextBalance =
      (balanceByPatient.get(line.patientId) ?? 0) + line.debit - line.credit;
    balanceByPatient.set(line.patientId, nextBalance);

    return {
      id: line.id,
      patientId: line.patientId,
      patientName: line.patientName || line.patientId,
      clinicId: line.clinicId,
      date: vietnamDate(line.occurredAt),
      kind: line.kind,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      balanceAfter: nextBalance,
    };
  });
}

function notificationAmount(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const amount = (value as { amount?: unknown }).amount;

  return typeof amount === "number" ? amount : null;
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function paymentMethodLabel(method: string) {
  const labels: Record<string, string> = {
    cash: "Cash",
    card: "Card",
    bank_transfer: "Bank transfer",
    credit_balance: "Credit balance",
    service_receipt: "Previous receipt",
    portal_demo: "Portal",
  };

  return labels[method] ?? method;
}

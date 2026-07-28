import "server-only";

import {
  appointments as demoAppointments,
  invoices as demoInvoices,
  patients as demoPatients,
  treatmentPlans as demoPlans,
  type Appointment,
  type Invoice,
  type TreatmentPlan,
} from "@/lib/data";
import type { PatientPortalWorkspace } from "@/lib/patient-portal-types";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

export async function getPatientPortalWorkspace(
  session: AppSession,
): Promise<PatientPortalWorkspace> {
  try {
    const patient = await findPortalPatient(session);

    if (!patient) {
      return {
        source: "database",
        canMutate: false,
        message:
          session.role === "PATIENT"
            ? "Tài khoản này chưa được liên kết với hồ sơ bệnh nhân."
            : "Chưa có dữ liệu trong phạm vi hiện tại.",
        patient: null,
        appointments: [],
        invoices: [],
        outstandingBalance: 0,
        treatmentPlans: [],
        patientFiles: [],
        treatmentServices: [],
      };
    }

    const now = new Date();
    const [appointments, invoices, invoiceTotals, plans, patientFiles, treatmentServices] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          patientId: patient.id,
          startsAt: {
            gte: now,
          },
          status: {
            notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"],
          },
        },
        include: {
          provider: {
            select: {
              fullName: true,
            },
          },
          chair: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          startsAt: "asc",
        },
        take: 6,
      }),
      prisma.invoice.findMany({
        where: {
          patientId: patient.id,
        },
        orderBy: {
          dueDate: "asc",
        },
        take: 6,
      }),
      prisma.invoice.aggregate({
        where: {
          patientId: patient.id,
          status: {
            notIn: ["PAID", "VOID"],
          },
        },
        _sum: {
          amount: true,
          paidAmount: true,
        },
      }),
      prisma.treatmentPlan.findMany({
        where: {
          patientId: patient.id,
        },
        include: {
          phases: {
            orderBy: {
              sequence: "asc",
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 4,
      }),
      prisma.patientFile.findMany({
        where: {
          patientId: patient.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 8,
      }),
      prisma.treatmentService.findMany({
        where: {
          patientId: patient.id,
        },
        include: {
          receiptAllocations: {
            select: {
              amount: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 8,
      }),
    ]);

    return {
      source: "database",
      canMutate: ["PATIENT", "FRONT_DESK", "CLINIC_MANAGER", "OWNER", "AREA_MANAGER"].includes(
        session.role,
      ),
      message: null,
      patient: {
        id: patient.id,
        name: patient.fullName,
        clinicId: patient.clinicId,
        clinic: patient.clinic.name,
        phone: patient.phone,
        email: patient.email,
        consent:
          patient.consents[0]?.status === "GRANTED" ? "Granted" : "Needs renewal",
      },
      appointments: appointments.map((appointment) => ({
        id: appointment.id,
        time: vietnamDateTime(appointment.startsAt),
        patient: patient.fullName,
        patientId: patient.id,
        clinicId: patient.clinicId,
        provider: appointment.provider.fullName,
        providerId: appointment.providerId,
        room: appointment.chair?.name ?? "Unassigned",
        chairId: appointment.chairId ?? null,
        procedure: appointment.reason,
        status: appointmentStatusLabel(appointment.status),
        duration: Math.max(
          Math.round(
            (appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60000,
          ),
          0,
        ),
        startsAt: appointment.startsAt.toISOString(),
        endsAt: appointment.endsAt.toISOString(),
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice.invoiceNo,
        patient: patient.fullName,
        patientId: patient.id,
        clinicId: patient.clinicId,
        amount: Number(invoice.amount),
        paidAmount: Number(invoice.paidAmount),
        status: invoiceStatusLabel(invoice.status, invoice.dueDate),
        due: vietnamDate(invoice.dueDate),
      })),
      outstandingBalance: Math.max(
        Number(invoiceTotals._sum.amount ?? 0) - Number(invoiceTotals._sum.paidAmount ?? 0),
        0,
      ),
      treatmentPlans: plans.map((plan) => ({
        id: plan.id,
        patient: patient.fullName,
        patientId: patient.id,
        clinicId: patient.clinicId,
        title: plan.title,
        phase: plan.phases[0]?.name ?? "Unphased",
        status: treatmentStatusLabel(plan.status),
        estimatedCost: Number(plan.totalAmount),
        patientShare: Number(plan.patientDue),
        tasks:
          plan.phases.flatMap((phase) => phase.procedures).length > 0
            ? plan.phases.flatMap((phase) => phase.procedures)
            : ["No procedures added"],
        createdAt: plan.createdAt.toISOString(),
      })),
      patientFiles: patientFiles.map((file) => ({
        id: file.id,
        category: file.category,
        title: file.title,
        fileName: file.fileName,
        mimeType: file.mimeType,
        url: file.sourceType === "LOCAL_UPLOAD" ? `/patient-files/${file.id}` : file.url,
        createdAt: vietnamDateTime(file.createdAt),
      })),
      treatmentServices: treatmentServices.map((service) => {
        const collectedAmount = service.receiptAllocations.reduce(
          (total, allocation) => total + Number(allocation.amount),
          0,
        );
        const finalPrice = Number(service.finalPrice);

        return {
          id: service.id,
          serviceCode: service.serviceCode,
          serviceName: service.serviceName,
          targetSummary: service.targetSummary,
          status: treatmentServiceStatusLabel(service.status),
          finalPrice,
          currentProgressPercent: Number(service.currentProgressPercent),
          collectedAmount,
          remainingAmount: Math.max(finalPrice - collectedAmount, 0),
          updatedAt: vietnamDateTime(service.updatedAt),
        };
      }),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "patient-portal");
    return demoPatientPortalWorkspace(session);
  }
}

async function findPortalPatient(session: AppSession) {
  const clinicIds = session.activeClinicId
    ? [session.activeClinicId]
    : session.clinicIds;

  return prisma.patient.findFirst({
    where: {
      organizationId: session.organizationId,
      clinicId: {
        in: clinicIds,
      },
      ...(session.role === "PATIENT"
        ? {
            portalUserId: session.userId,
          }
        : {}),
    },
    include: {
      clinic: {
        select: {
          name: true,
        },
      },
      consents: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
      },
    },
    orderBy: {
      fullName: "asc",
    },
  });
}

function demoPatientPortalWorkspace(session: AppSession): PatientPortalWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const patient =
    demoPatients.find((candidate) => allowedIds.has(candidate.clinicId)) ?? null;

  if (!patient) {
    return {
      source: "demo",
      canMutate: false,
      message: "Chưa có dữ liệu trong phạm vi hiện tại.",
      patient: null,
      appointments: [],
      invoices: [],
      outstandingBalance: 0,
      treatmentPlans: [],
      patientFiles: [],
      treatmentServices: [],
    };
  }

  const invoices = demoInvoices.filter((invoice) => invoice.patientId === patient.id);

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    patient: {
      id: patient.id,
      name: patient.name,
      clinicId: patient.clinicId,
      clinic: patient.city,
      phone: patient.phone,
      email: patient.email ?? null,
      consent: patient.consent,
    },
    appointments: demoAppointments.filter(
      (appointment) => appointment.patientId === patient.id,
    ),
    invoices,
    outstandingBalance: invoices.reduce(
      (total, invoice) => total + invoice.amount - (invoice.paidAmount ?? 0),
      0,
    ),
    treatmentPlans: demoPlans.filter((plan) => plan.patientId === patient.id),
    patientFiles: [],
    treatmentServices: [],
  };
}

function appointmentStatusLabel(status: string): Appointment["status"] {
  const labels: Record<string, Appointment["status"]> = {
    REQUESTED: "Requested",
    CONFIRMED: "Confirmed",
    ARRIVED: "Arrived",
    IN_CHAIR: "In chair",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
    NO_SHOW: "No-show",
  };

  return labels[status] ?? "Confirmed";
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

function treatmentStatusLabel(status: string): TreatmentPlan["status"] {
  const labels: Record<string, TreatmentPlan["status"]> = {
    DRAFT: "Draft",
    PRESENTED: "Presented",
    ACCEPTED: "Accepted",
    IN_PROGRESS: "In progress",
    COMPLETED: "Completed",
    DECLINED: "Declined",
  };

  return labels[status] ?? "Draft";
}

function treatmentServiceStatusLabel(status: string) {
  const labels: Record<string, string> = {
    PLANNED: "Planned",
    IN_PROGRESS: "In progress",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
  };

  return labels[status] ?? status;
}

function vietnamDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

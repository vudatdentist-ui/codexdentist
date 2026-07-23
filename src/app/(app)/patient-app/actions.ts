"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { nextDocumentNo } from "@/lib/document-sequence";
import { databaseActorId, requiredString } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export async function confirmPortalAppointmentAction(formData: FormData) {
  const session = await requireViewSession("patient-app");
  const appointmentId = requiredString(formData.get("appointmentId"));

  if (!appointmentId) {
    redirect("/patient-app?notice=portal-appointment-not-found");
  }

  let notice: string | null = null;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        ...portalPatientScope(session),
      },
      select: {
        id: true,
      },
    });

    if (!appointment) {
      notice = "portal-appointment-not-found";
    } else {
      await prisma.appointment.update({
        where: {
          id: appointmentId,
        },
        data: {
          status: "CONFIRMED",
        },
      });

      await writePortalAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient_portal.appointment_confirmed",
        entityType: "Appointment",
        entityId: appointmentId,
      });
    }
  } catch {
    notice = "portal-database";
  }

  if (notice) {
    redirect(`/patient-app?notice=${notice}`);
  }

  revalidatePath("/patient-app");
  redirect("/patient-app?notice=portal-appointment-confirmed");
}

export async function payPortalInvoiceAction(formData: FormData) {
  const session = await requireViewSession("patient-app");
  const invoiceNo = requiredString(formData.get("invoiceNo"));

  if (!invoiceNo) {
    redirect("/patient-app?notice=portal-invoice-not-found");
  }

  let notice: string | null = null;

  try {
    const invoice = await prisma.invoice.findFirst({
      where: {
        invoiceNo,
        ...portalPatientScope(session),
      },
      select: {
        id: true,
        amount: true,
        clinicId: true,
        patientId: true,
        paidAmount: true,
        status: true,
      },
    });

    if (!invoice || invoice.status === "VOID") {
      notice = "portal-invoice-not-found";
    } else {
      const due = Math.max(Number(invoice.amount) - Number(invoice.paidAmount), 0);

      if (due <= 0) {
        notice = "portal-invoice-paid";
      } else {
        await prisma.$transaction(async (tx) => {
          const receiptNo = await nextPortalReceiptNo(session.organizationId, tx);
          const receipt = await tx.receipt.create({
            data: {
              organizationId: session.organizationId,
              clinicId: invoice.clinicId,
              patientId: invoice.patientId,
              receiptNo,
              amount: due,
              allocatedAmount: due,
              unallocatedAmount: 0,
              method: "patient_portal",
              reference: invoiceNo,
              note: "Patient portal invoice payment",
            },
            select: {
              id: true,
              receiptNo: true,
            },
          });
          const nextPaid = Number(invoice.paidAmount) + due;
          const nextStatus = nextPaid >= Number(invoice.amount) ? "PAID" : "PARTIAL";

          await tx.payment.create({
            data: {
              invoiceId: invoice.id,
              amount: due,
              method: "patient_portal",
              reference: receipt.receiptNo,
            },
          });
          await tx.receiptAllocation.create({
            data: {
              organizationId: session.organizationId,
              clinicId: invoice.clinicId,
              patientId: invoice.patientId,
              receiptId: receipt.id,
              invoiceId: invoice.id,
              amount: due,
              note: "Patient portal invoice payment",
            },
          });
          await tx.invoice.update({
            where: {
              id: invoice.id,
            },
            data: {
              paidAmount: nextPaid,
              status: nextStatus,
            },
          });
          await tx.auditLog.create({
            data: {
              organizationId: session.organizationId,
              actorId: databaseActorId(session.userId),
              action: "patient_portal.invoice_paid",
              entityType: "Invoice",
              entityId: invoice.id,
              metadata: {
                invoiceNo,
                receiptNo: receipt.receiptNo,
                amount: due,
              } as Prisma.InputJsonValue,
            },
          });
        });
      }
    }
  } catch {
    notice = "portal-database";
  }

  if (notice) {
    redirect(`/patient-app?notice=${notice}`);
  }

  revalidatePath("/patient-app");
  redirect("/patient-app?notice=portal-invoice-paid");
}

export async function acceptPortalTreatmentAction(formData: FormData) {
  const session = await requireViewSession("patient-app");
  const planId = requiredString(formData.get("planId"));

  if (!planId) {
    redirect("/patient-app?notice=portal-plan-not-found");
  }

  let notice: string | null = null;

  try {
    const plan = await prisma.treatmentPlan.findFirst({
      where: {
        id: planId,
        patient: portalPatientScope(session).patient,
      },
      select: {
        id: true,
      },
    });

    if (!plan) {
      notice = "portal-plan-not-found";
    } else {
      await prisma.treatmentPlan.update({
        where: {
          id: planId,
        },
        data: {
          status: "ACCEPTED",
        },
      });

      await writePortalAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient_portal.treatment_accepted",
        entityType: "TreatmentPlan",
        entityId: planId,
      });
    }
  } catch {
    notice = "portal-database";
  }

  if (notice) {
    redirect(`/patient-app?notice=${notice}`);
  }

  revalidatePath("/patient-app");
  redirect("/patient-app?notice=portal-plan-accepted");
}

export async function renewPortalConsentAction(formData: FormData) {
  const session = await requireViewSession("patient-app");
  const patientId = requiredString(formData.get("patientId"));

  if (!patientId) {
    redirect("/patient-app?notice=portal-patient-not-found");
  }

  let notice: string | null = null;

  try {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        ...portalPatientScope(session).patient,
      },
      select: {
        id: true,
      },
    });

    if (!patient) {
      notice = "portal-patient-not-found";
    } else {
      const consent = await prisma.patientConsent.create({
        data: {
          patientId,
          status: "GRANTED",
          purpose: "Health data processing for dental care",
          channel: "patient_portal",
          signedAt: new Date(),
          expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          version: "vn-simple-v1",
        },
        select: {
          id: true,
        },
      });

      await writePortalAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "patient_portal.consent_renewed",
        entityType: "PatientConsent",
        entityId: consent.id,
        metadata: {
          patientId,
        },
      });
    }
  } catch {
    notice = "portal-database";
  }

  if (notice) {
    redirect(`/patient-app?notice=${notice}`);
  }

  revalidatePath("/patient-app");
  redirect("/patient-app?notice=portal-consent-renewed");
}

function portalPatientScope(session: AppSession) {
  const clinicIds = session.activeClinicId
    ? [session.activeClinicId]
    : session.clinicIds;

  return {
    patient: {
      organizationId: session.organizationId,
      clinicId: {
        in: clinicIds,
      },
      ...(session.role === "PATIENT"
        ? {
            email: session.email,
          }
        : {}),
    },
  };
}

type PatientPortalDbClient = Prisma.TransactionClient | typeof prisma;

async function nextPortalReceiptNo(organizationId: string, client: PatientPortalDbClient = prisma) {
  return nextDocumentNo({
    client,
    organizationId,
    type: "RCT",
    seedCurrentValue: () =>
      client.receipt.count({
        where: {
          organizationId,
        },
      }).then((count) => 1000 + count),
  });
}

async function writePortalAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

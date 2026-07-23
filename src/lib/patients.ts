import "server-only";

import {
  clinics as demoClinics,
  patients as demoPatients,
  type Clinic,
  type Patient,
} from "@/lib/data";
import { allowedClinicIds, patientAccessWhere } from "@/lib/patient-access";
import { hasAnyRole } from "@/lib/permissions";
import type { AppRole } from "@/lib/permissions";
import type { PatientWorkspace } from "@/lib/patient-types";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

const mutablePatientRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];

export async function getPatientWorkspace(
  session: AppSession,
): Promise<PatientWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);

    const [dbClinics, dbPatients] = await Promise.all([
      prisma.clinic.findMany({
        where: {
          organizationId: session.organizationId,
          id: {
            in: clinicIds,
          },
        },
        include: {
          chain: {
            select: {
              id: true,
              name: true,
            },
          },
          chairs: {
            where: {
              active: true,
            },
            select: {
              id: true,
            },
          },
          users: {
            select: {
              userId: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.patient.findMany({
        where: patientAccessWhere(session),
        include: {
          clinic: {
            select: {
              city: true,
            },
          },
          consents: {
            orderBy: {
              createdAt: "desc",
            },
            take: 5,
          },
          appointments: {
            select: {
              startsAt: true,
              status: true,
            },
            orderBy: {
              startsAt: "desc",
            },
          },
          invoices: {
            select: {
              amount: true,
              paidAmount: true,
              status: true,
            },
          },
          treatmentPlans: {
            select: {
              status: true,
            },
          },
        },
        orderBy: {
          fullName: "asc",
        },
      }),
    ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutablePatientRoles) && dbClinics.length > 0,
      message:
        dbClinics.length === 0
          ? "Tài khoản này chưa có phòng khám hoạt động trong phạm vi hiện tại."
          : null,
      clinics: dbClinics.map((clinic) => toClinicSummary(clinic)),
      patients: dbPatients.map((patient) => toPatientSummary(patient)),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "patients");
    return demoPatientWorkspace(session);
  }
}

function demoPatientWorkspace(session: AppSession): PatientWorkspace {
  const allowedIds = new Set(session.clinicIds);

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    clinics: demoClinics.filter((clinic) => allowedIds.has(clinic.id)),
    patients: demoPatients.filter((patient) => allowedIds.has(patient.clinicId)),
  };
}

function toClinicSummary(clinic: {
  id: string;
  chainId: string | null;
  chain: {
    id: string;
    name: string;
  } | null;
  name: string;
  city: string;
  active: boolean;
  chairs: unknown[];
  users: unknown[];
}): Clinic {
  const existingSummary = demoClinics.find((demoClinic) => demoClinic.id === clinic.id);

  return {
    id: clinic.id,
    chainId: clinic.chainId,
    chainName: clinic.chain?.name ?? null,
    name: clinic.name,
    city: clinic.city,
    active: clinic.active,
    chairs: clinic.chairs.length,
    doctors: existingSummary?.doctors ?? clinic.users.length,
    todayVisits: existingSummary?.todayVisits ?? 0,
    utilization: existingSummary?.utilization ?? 0,
    production: existingSummary?.production ?? 0,
    collection: existingSummary?.collection ?? 0,
    pendingClaims: existingSummary?.pendingClaims ?? 0,
  };
}

function toPatientSummary(patient: {
  id: string;
  fullName: string;
  dateOfBirth: Date | null;
  phone: string;
  email: string | null;
  gender: string | null;
  visitReason: string | null;
  leadSource: string | null;
  clinicId: string;
  guardianName: string | null;
  address: string | null;
  nationalId: string | null;
  medicalAlerts: string[];
  clinic: {
    city: string;
  };
  consents: Array<{
    id: string;
    status: string;
    signedAt: Date | null;
    expiresAt: Date | null;
    version: string;
    channel: string;
    createdAt: Date;
  }>;
  appointments: Array<{
    startsAt: Date;
    status: string;
  }>;
  invoices: Array<{
    amount: unknown;
    paidAmount: unknown;
    status: string;
  }>;
  treatmentPlans: Array<{
    status: string;
  }>;
}): Patient {
  const consent = patient.consents[0];

  return {
    id: patient.id,
    name: patient.fullName,
    age: patient.dateOfBirth ? ageFromDate(patient.dateOfBirth) : 0,
    phone: patient.phone,
    email: patient.email,
    gender: patient.gender,
    visitReason: patient.visitReason,
    leadSource: patient.leadSource,
    city: patient.clinic.city,
    clinicId: patient.clinicId,
    dateOfBirth: patient.dateOfBirth
      ? vietnamDateInput(patient.dateOfBirth)
      : null,
    guardianName: patient.guardianName,
    address: patient.address,
    nationalId: patient.nationalId,
    nextVisit: appointmentLabel(patient.appointments, "future"),
    lastVisit: appointmentLabel(patient.appointments, "past"),
    balance: patient.invoices.reduce(
      (total, invoice) =>
        invoice.status === "PAID" || invoice.status === "VOID"
          ? total
          : total + Number(invoice.amount) - Number(invoice.paidAmount),
      0,
    ),
    consent: consentLabel(consent),
    consentVersion: consent?.version ?? null,
    consentSignedAt: consent?.signedAt ? vietnamDateInput(consent.signedAt) : null,
    consentHistory: patient.consents.map((item) => ({
      id: item.id,
      status: consentLabel(item),
      version: item.version,
      signedAt: item.signedAt ? vietnamDateInput(item.signedAt) : null,
      recordedAt: vietnamDateInput(item.createdAt),
      channel: item.channel,
    })),
    flags:
      patient.medicalAlerts.length > 0
        ? patient.medicalAlerts
        : ["No medical alerts recorded"],
    treatmentProgress: treatmentProgress(patient.treatmentPlans),
  };
}

function ageFromDate(date: Date) {
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDelta = today.getMonth() - date.getMonth();

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < date.getDate())) {
    age -= 1;
  }

  return Math.max(age, 0);
}

function appointmentLabel(
  appointments: Array<{ startsAt: Date; status: string }>,
  direction: "future" | "past",
) {
  const now = new Date();
  const filtered = appointments
    .filter((appointment) =>
      direction === "future"
        ? appointment.startsAt >= now
        : appointment.startsAt < now,
    )
    .sort((first, second) =>
      direction === "future"
        ? first.startsAt.getTime() - second.startsAt.getTime()
        : second.startsAt.getTime() - first.startsAt.getTime(),
    );

  const appointment = filtered[0];

  if (!appointment) {
    return direction === "future" ? "Not booked" : "No visit";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(appointment.startsAt);
}

function consentLabel(
  consent?: {
    status: string;
    expiresAt: Date | null;
  },
): Patient["consent"] {
  if (!consent) {
    return "Needs renewal";
  }

  if (consent.status !== "GRANTED") {
    return "Needs renewal";
  }

  if (consent.expiresAt && consent.expiresAt < new Date()) {
    return "Needs renewal";
  }

  return "Granted";
}

function treatmentProgress(plans: Array<{ status: string }>) {
  if (plans.length === 0) {
    return 0;
  }

  const scores: Record<string, number> = {
    DRAFT: 10,
    PRESENTED: 25,
    ACCEPTED: 45,
    IN_PROGRESS: 70,
    COMPLETED: 100,
    DECLINED: 0,
  };

  const total = plans.reduce((sum, plan) => sum + (scores[plan.status] ?? 0), 0);

  return Math.round(total / plans.length);
}

function vietnamDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

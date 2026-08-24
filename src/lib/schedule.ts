import "server-only";

import {
  appointments as demoAppointments,
  clinics as demoClinics,
  patients as demoPatients,
  type Appointment,
} from "@/lib/data";
import { allowedClinicIds } from "@/lib/patient-access";
import { hasAnyRole } from "@/lib/permissions";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type {
  ScheduleProviderOption,
  ScheduleWorkspace,
} from "@/lib/schedule-types";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";

type DbAppointment = Awaited<
  ReturnType<typeof prisma.appointment.findMany>
>[number] & {
  patient: {
    id: string;
    fullName: string;
  };
  provider: {
    id: string;
    fullName: string;
  };
  chair: {
    id: string;
    name: string;
  } | null;
};

const mutableScheduleRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
];
const schedulableProviderRoles: AppRole[] = ["DENTIST", "HYGIENIST", "CLINIC_MANAGER"];

export async function getScheduleWorkspace(
  session: AppSession,
  options: { patientId?: string; scope?: "today" | "all" } = {},
): Promise<ScheduleWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);
    const { start, end } = currentVietnamDayRange();
    const appointmentWindow =
      options.scope === "all"
        ? {}
        : {
            startsAt: {
              gte: start,
              lt: end,
            },
          };

    const [dbClinics, dbPatients, dbProviders, dbAppointments] =
      await Promise.all([
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
              orderBy: {
                name: "asc",
              },
            },
          },
          orderBy: {
            name: "asc",
          },
        }),
        prisma.patient.findMany({
          where: {
            organizationId: session.organizationId,
            clinicId: {
              in: clinicIds,
            },
            ...(options.patientId ? { id: options.patientId } : {}),
          },
          select: {
            id: true,
            fullName: true,
            clinicId: true,
            phone: true,
          },
          orderBy: {
            fullName: "asc",
          },
        }),
        prisma.user.findMany({
          where: {
            organizationId: session.organizationId,
            active: true,
            OR: [
              {
                role: {
                  in: schedulableProviderRoles,
                },
              },
              {
                roleAssignments: {
                  some: {
                    active: true,
                    role: {
                      in: schedulableProviderRoles,
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
                  },
                },
              },
            ],
            clinics: {
              some: {
                clinicId: {
                  in: clinicIds,
                },
              },
            },
          },
          include: {
            clinics: {
              select: {
                clinicId: true,
              },
            },
            roleAssignments: {
              where: {
                active: true,
                role: {
                  in: schedulableProviderRoles,
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
              },
              select: {
                role: true,
              },
            },
          },
          orderBy: {
            fullName: "asc",
          },
        }),
        prisma.appointment.findMany({
          where: {
            clinicId: {
              in: clinicIds,
            },
            ...(options.patientId ? { patientId: options.patientId } : {}),
            ...appointmentWindow,
          },
          include: {
            patient: {
              select: {
                id: true,
                fullName: true,
              },
            },
            provider: {
              select: {
                id: true,
                fullName: true,
              },
            },
            chair: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          orderBy: {
            startsAt: "asc",
          },
        }),
      ]);

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableScheduleRoles) && dbClinics.length > 0,
      message:
        dbClinics.length === 0
          ? "Tài khoản này chưa có phòng khám hoạt động trong phạm vi hiện tại."
          : null,
      clinics: dbClinics.map((clinic) => toClinicSummary(clinic)),
      patients: dbPatients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        clinicId: patient.clinicId,
        phone: patient.phone,
      })),
      providers: dbProviders.map((provider) => ({
        id: provider.id,
        name: provider.fullName,
        role: providerRoleForSchedule(provider.role, provider.roleAssignments),
        clinicIds: provider.clinics.map((clinic) => clinic.clinicId),
        operationalStatus: normalizeOperationalStatus(provider.operationalStatus),
      })),
      chairs: dbClinics.flatMap((clinic) =>
        clinic.chairs.map((chair) => ({
          id: chair.id,
          name: chair.name,
          clinicId: clinic.id,
          operationalStatus: normalizeOperationalStatus(chair.operationalStatus),
        })),
      ),
      appointments: dbAppointments.map((appointment) =>
        toScheduleAppointment(appointment),
      ),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "schedule");
    return demoScheduleWorkspace(session);
  }
}

function demoScheduleWorkspace(session: AppSession): ScheduleWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const clinics = demoClinics.filter((clinic) => allowedIds.has(clinic.id));

  return {
    source: "demo",
    canMutate: false,
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    clinics,
    patients: demoPatients
      .filter((patient) => allowedIds.has(patient.clinicId))
      .map((patient) => ({
        id: patient.id,
        name: patient.name,
        clinicId: patient.clinicId,
        phone: patient.phone,
      })),
    providers: uniqueProviders(
      demoAppointments.filter((appointment) => allowedIds.has(appointment.clinicId)),
    ),
    chairs: clinics.flatMap((clinic) =>
      Array.from({ length: clinic.chairs }, (_, index) => ({
        id: `${clinic.id}-demo-chair-${index + 1}`,
        name: `Chair ${index + 1}`,
        clinicId: clinic.id,
        operationalStatus: "READY",
      })),
    ),
    appointments: demoAppointments.filter((appointment) =>
      allowedIds.has(appointment.clinicId),
    ),
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
}) {
  const existingSummary = demoClinics.find((demoClinic) => demoClinic.id === clinic.id);

  return {
    id: clinic.id,
    chainId: clinic.chainId,
    chainName: clinic.chain?.name ?? null,
    name: clinic.name,
    city: clinic.city,
    active: clinic.active,
    chairs: clinic.chairs.length,
    doctors: existingSummary?.doctors ?? 0,
    todayVisits: existingSummary?.todayVisits ?? 0,
    utilization: existingSummary?.utilization ?? 0,
    production: existingSummary?.production ?? 0,
    collection: existingSummary?.collection ?? 0,
    pendingClaims: existingSummary?.pendingClaims ?? 0,
  };
}

function toScheduleAppointment(appointment: DbAppointment): Appointment {
  const startsAt = appointment.startsAt;
  const endsAt = appointment.endsAt;
  const duration = Math.max(
    Math.round((endsAt.getTime() - startsAt.getTime()) / 60000),
    0,
  );

  return {
    id: appointment.id,
    time: vietnamTime(startsAt),
    patient: appointment.patient.fullName,
    patientId: appointment.patient.id,
    clinicId: appointment.clinicId,
    provider: appointment.provider.fullName,
    providerId: appointment.providerId,
    room: appointment.chair?.name ?? "Unassigned",
    chairId: appointment.chairId ?? null,
    procedure: appointment.reason,
    status: appointmentStatusLabel(appointment.status),
    duration,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
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

function uniqueProviders(scheduleAppointments: Appointment[]) {
  const providers = new Map<string, ScheduleProviderOption>();

  for (const appointment of scheduleAppointments) {
    const id = appointment.provider.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const existing = providers.get(id);

    if (existing) {
      existing.clinicIds = Array.from(
        new Set([...existing.clinicIds, appointment.clinicId]),
      );
      continue;
    }

    providers.set(id, {
      id,
      name: appointment.provider,
      role: "DENTIST",
      clinicIds: [appointment.clinicId],
      operationalStatus: "READY",
    });
  }

  return Array.from(providers.values());
}

function providerRoleForSchedule(
  legacyRole: AppRole,
  assignments: Array<{ role: AppRole }>,
) {
  return (
    schedulableProviderRoles.find((role) =>
      assignments.some((assignment) => assignment.role === role),
    ) ??
    (schedulableProviderRoles.includes(legacyRole) ? legacyRole : "DENTIST")
  );
}

function normalizeOperationalStatus(value: string | null | undefined): "READY" | "BUSY" {
  return value === "BUSY" ? "BUSY" : "READY";
}

function currentVietnamDayRange() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = formatter.format(new Date());

  return {
    start: new Date(`${date}T00:00:00+07:00`),
    end: new Date(`${date}T23:59:59.999+07:00`),
  };
}

function vietnamTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

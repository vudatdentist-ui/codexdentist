"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  parseDateTimeInVietnam,
  requiredString,
} from "@/lib/form-validation";
import { allowedClinicIds } from "@/lib/patient-access";
import type { AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const allowedStatusUpdates = [
  "REQUESTED",
  "CONFIRMED",
  "ARRIVED",
  "IN_CHAIR",
  "COMPLETED",
  "NO_SHOW",
] as const;
const schedulableProviderRoles: AppRole[] = ["DENTIST", "HYGIENIST", "CLINIC_MANAGER"];

function scheduleRedirect(
  notice: string,
  patientId?: string | null,
  context: {
    clinicId?: string | null;
    date?: string | null;
    dateTo?: string | null;
    providerId?: string | null;
    status?: string | null;
  } = {},
) {
  const params = new URLSearchParams({ notice });

  if (patientId) {
    params.set("patientId", patientId);
  }

  if (context.clinicId) {
    params.set("clinicId", context.clinicId);
  }

  if (context.date) {
    params.set("date", context.date);
  }

  if (context.dateTo) {
    params.set("dateTo", context.dateTo);
  }

  if (context.providerId) {
    params.set("providerId", context.providerId);
  }

  if (context.status) {
    params.set("status", context.status);
  }

  return `/schedule?${params.toString()}`;
}

export async function createAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.create")) {
    redirect("/schedule?notice=denied");
  }

  const clinicIds = allowedClinicIds(session);
  const clinicId = requiredString(formData.get("clinicId"));
  const patientId = requiredString(formData.get("patientId"));
  const providerId = requiredString(formData.get("providerId"));
  const chairId = requiredString(formData.get("chairId"));
  const date = requiredString(formData.get("date"));
  const startTime = requiredString(formData.get("startTime"));
  const duration = Number(formData.get("duration") ?? 30);
  const reason = requiredString(formData.get("reason"));

  if (!canUseClinic(clinicIds, clinicId)) {
    redirect(scheduleRedirect("clinic-denied", patientId, { clinicId, date }));
  }

  if (!patientId || !providerId || !date || !startTime || !reason) {
    redirect(scheduleRedirect("missing-fields", patientId, { clinicId, date }));
  }

  if (!Number.isFinite(duration) || duration < 15 || duration > 240) {
    redirect(scheduleRedirect("bad-duration", patientId, { clinicId, date }));
  }

  const startsAt = parseDateTimeInVietnam(date, startTime);

  if (startsAt === "invalid") {
    redirect(scheduleRedirect("bad-time", patientId, { clinicId, date }));
  }

  const endsAt = new Date(startsAt.getTime() + duration * 60000);

  let notice: string | null = null;

  try {
    const [clinic, patient, provider, chair] = await Promise.all([
      prisma.clinic.findFirst({
        where: {
          id: clinicId,
          organizationId: session.organizationId,
          active: true,
        },
        select: {
          id: true,
        },
      }),
      prisma.patient.findFirst({
        where: {
          id: patientId,
          organizationId: session.organizationId,
          clinicId,
        },
        select: {
          id: true,
        },
      }),
      prisma.user.findFirst({
        where: {
          id: providerId,
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
                      clinicId,
                    },
                  ],
                },
              },
            },
          ],
          clinics: {
            some: {
              clinicId,
            },
          },
        },
        select: {
          id: true,
        },
      }),
      chairId
        ? prisma.chair.findFirst({
            where: {
              id: chairId,
              clinicId,
              active: true,
            },
            select: {
              id: true,
            },
          })
        : Promise.resolve(null),
    ]);

    if (!clinic) {
      notice = "clinic-inactive";
    } else if (!patient || !provider || (chairId && !chair)) {
      notice = "invalid-relation";
    } else {
      const conflict = await prisma.appointment.findFirst({
        where: {
          clinicId,
          status: {
            notIn: ["CANCELLED", "NO_SHOW"],
          },
          startsAt: {
            lt: endsAt,
          },
          endsAt: {
            gt: startsAt,
          },
          OR: [
            {
              providerId,
            },
            ...(chairId
              ? [
                  {
                    chairId,
                  },
                ]
              : []),
          ],
        },
        select: {
          id: true,
        },
      });

      if (conflict) {
        notice = "conflict";
      } else {
        const appointment = await prisma.appointment.create({
          data: {
            clinicId,
            patientId,
            providerId,
            chairId: chairId || null,
            status: "CONFIRMED",
            startsAt,
            endsAt,
            reason,
            source: "staff",
          },
          select: {
            id: true,
          },
        });

        await writeAuditLog({
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "appointment.created",
          entityId: appointment.id,
          metadata: {
            clinicId,
            patientId,
            providerId,
            chairId: chairId || null,
            startsAt: startsAt.toISOString(),
          },
        });
      }
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(scheduleRedirect(notice, patientId, { clinicId, date }));
  }

  revalidatePath("/schedule");
  redirect(scheduleRedirect("created", patientId, { clinicId, date }));
}

export async function updateAppointmentStatusAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.update")) {
    redirect("/schedule?notice=denied");
  }

  const clinicIds = allowedClinicIds(session);
  const appointmentId = requiredString(formData.get("appointmentId"));
  const postedPatientId = requiredString(formData.get("patientId"));
  const postedClinicId = requiredString(formData.get("clinicId"));
  const postedDate = requiredString(formData.get("date"));
  const postedDateTo = requiredString(formData.get("dateTo"));
  const postedProviderId = requiredString(formData.get("providerFilter"));
  const postedStatus = requiredString(formData.get("statusFilter"));
  const requestedChairId = requiredString(formData.get("chairId"));
  const releaseChair = requiredString(formData.get("releaseChair")) === "1";
  const status = requiredString(formData.get("status"));
  const redirectContext = {
    clinicId: postedClinicId || null,
    date: postedDate || null,
    dateTo: postedDateTo || null,
    providerId: postedProviderId === "all" ? null : postedProviderId,
    status: postedStatus === "all" ? null : postedStatus,
  };

  if (!appointmentId || !isAllowedStatus(status)) {
    redirect(scheduleRedirect("bad-status", postedPatientId, redirectContext));
  }

  let notice: string | null = null;
  let patientId = postedPatientId;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        clinicId: {
          in: clinicIds,
        },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        providerId: true,
        startsAt: true,
      },
    });

    if (!appointment) {
      notice = "not-found";
    } else {
      patientId = appointment.patientId;
      redirectContext.clinicId = redirectContext.clinicId ?? appointment.clinicId;
      redirectContext.date = redirectContext.date ?? vietnamDateInput(appointment.startsAt);
      let nextChairId: string | undefined;

      if (isBeforeTodayInVietnam(appointment.startsAt)) {
        notice = "past-appointment-locked";
      }

      if (!notice && status === "IN_CHAIR") {
        if (!requestedChairId) {
          notice = "missing-fields";
        } else {
          const chair = await prisma.chair.findFirst({
            where: {
              id: requestedChairId,
              clinicId: appointment.clinicId,
              active: true,
            },
            select: {
              id: true,
            },
          });

          if (!chair) {
            notice = "invalid-relation";
          } else {
            nextChairId = chair.id;
          }
        }
      }

      if (!notice) {
        await prisma.$transaction(async (tx) => {
          await tx.appointment.update({
            where: {
              id: appointmentId,
            },
            data: {
              status,
              ...(releaseChair
                ? { chairId: null }
                : nextChairId
                  ? { chairId: nextChairId }
                  : {}),
            },
          });

          if (status === "IN_CHAIR" && nextChairId) {
            await tx.chair.update({
              where: {
                id: nextChairId,
              },
              data: {
                operationalStatus: "BUSY",
                operationalStatusUpdatedAt: new Date(),
              },
            });

            await tx.user.update({
              where: {
                id: appointment.providerId,
              },
              data: {
                operationalStatus: "BUSY",
                operationalStatusUpdatedAt: new Date(),
              },
            });
          }
        });

        await writeAuditLog({
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "appointment.status_updated",
          entityId: appointmentId,
          metadata: {
            status,
            chairId: releaseChair ? null : nextChairId,
            releaseChair,
          },
        });
      }
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(scheduleRedirect(notice, patientId, redirectContext));
  }

  revalidatePath("/schedule");
  redirect(scheduleRedirect("updated", patientId, redirectContext));
}

export async function cancelAppointmentAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.cancel")) {
    redirect("/schedule?notice=denied");
  }

  const clinicIds = allowedClinicIds(session);
  const appointmentId = requiredString(formData.get("appointmentId"));
  const postedPatientId = requiredString(formData.get("patientId"));
  const postedClinicId = requiredString(formData.get("clinicId"));
  const postedDate = requiredString(formData.get("date"));
  const postedDateTo = requiredString(formData.get("dateTo"));
  const postedProviderId = requiredString(formData.get("providerFilter"));
  const postedStatus = requiredString(formData.get("statusFilter"));
  const redirectContext = {
    clinicId: postedClinicId || null,
    date: postedDate || null,
    dateTo: postedDateTo || null,
    providerId: postedProviderId === "all" ? null : postedProviderId,
    status: postedStatus === "all" ? null : postedStatus,
  };

  if (!appointmentId) {
    redirect(scheduleRedirect("not-found", postedPatientId, redirectContext));
  }

  let notice: string | null = null;
  let patientId = postedPatientId;

  try {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        clinicId: {
          in: clinicIds,
        },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        startsAt: true,
      },
    });

    if (!appointment) {
      notice = "not-found";
    } else {
      patientId = appointment.patientId;
      redirectContext.clinicId = redirectContext.clinicId ?? appointment.clinicId;
      redirectContext.date = redirectContext.date ?? vietnamDateInput(appointment.startsAt);

      if (isBeforeTodayInVietnam(appointment.startsAt)) {
        notice = "past-appointment-locked";
      } else {
        await prisma.appointment.update({
          where: {
            id: appointmentId,
          },
          data: {
            status: "CANCELLED",
          },
        });

        await writeAuditLog({
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "appointment.cancelled",
          entityId: appointmentId,
        });
      }
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(scheduleRedirect(notice, patientId, redirectContext));
  }

  revalidatePath("/schedule");
  redirect(scheduleRedirect("cancelled", patientId, redirectContext));
}

export async function updateChairOperationalStatusAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.update")) {
    redirect("/schedule?notice=denied");
  }

  const clinicIds = allowedClinicIds(session);
  const chairId = requiredString(formData.get("chairId"));
  const status = normalizeOperationalStatus(requiredString(formData.get("operationalStatus")));
  const postedPatientId = requiredString(formData.get("patientId"));
  const appointmentId = requiredString(formData.get("appointmentId"));
  const redirectContext = scheduleContextFromForm(formData);

  if (!chairId || !status) {
    redirect(scheduleRedirect("bad-status", postedPatientId, redirectContext));
  }

  let notice: string | null = null;

  try {
    const chair = await prisma.chair.findFirst({
      where: {
        id: chairId,
        clinicId: {
          in: clinicIds,
        },
      },
      select: {
        id: true,
        clinicId: true,
      },
    });

    if (!chair) {
      notice = "invalid-relation";
    } else {
      await prisma.$transaction(async (tx) => {
        await tx.chair.update({
          where: {
            id: chair.id,
          },
          data: {
            operationalStatus: status,
            operationalStatusUpdatedAt: new Date(),
          },
        });

        if (status === "READY" && appointmentId) {
          await tx.appointment.updateMany({
            where: {
              id: appointmentId,
              chairId: chair.id,
              clinicId: chair.clinicId,
            },
            data: {
              chairId: null,
            },
          });
        }
      });

      await writeAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "chair.operational_status_updated",
        entityId: chair.id,
        metadata: {
          status,
          appointmentId: appointmentId || null,
        },
      });
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(scheduleRedirect(notice, postedPatientId, redirectContext));
  }

  revalidatePath("/schedule");
  redirect(scheduleRedirect("updated", postedPatientId, redirectContext));
}

export async function updateProviderOperationalStatusAction(formData: FormData) {
  const session = await requireViewSession("schedule");

  if (!canPerformAction(session, "appointment.update")) {
    redirect("/schedule?notice=denied");
  }

  const clinicIds = allowedClinicIds(session);
  const providerId = requiredString(formData.get("providerId"));
  const status = normalizeOperationalStatus(requiredString(formData.get("operationalStatus")));
  const postedPatientId = requiredString(formData.get("patientId"));
  const redirectContext = scheduleContextFromForm(formData);

  if (!providerId || !status) {
    redirect(scheduleRedirect("bad-status", postedPatientId, redirectContext));
  }

  let notice: string | null = null;

  try {
    const provider = await prisma.user.findFirst({
      where: {
        id: providerId,
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
      select: {
        id: true,
      },
    });

    if (!provider) {
      notice = "invalid-relation";
    } else {
      await prisma.user.update({
        where: {
          id: provider.id,
        },
        data: {
          operationalStatus: status,
          operationalStatusUpdatedAt: new Date(),
        },
      });

      await writeAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "user.operational_status_updated",
        entityId: provider.id,
        metadata: {
          status,
        },
      });
    }
  } catch {
    notice = "database-unavailable";
  }

  if (notice) {
    redirect(scheduleRedirect(notice, postedPatientId, redirectContext));
  }

  revalidatePath("/schedule");
  redirect(scheduleRedirect("updated", postedPatientId, redirectContext));
}

function canUseClinic(clinicIds: string[], clinicId: string) {
  return clinicIds.includes(clinicId);
}

function isAllowedStatus(
  status: string,
): status is (typeof allowedStatusUpdates)[number] {
  return allowedStatusUpdates.includes(
    status as (typeof allowedStatusUpdates)[number],
  );
}

function normalizeOperationalStatus(status: string) {
  if (status === "READY" || status === "BUSY") {
    return status;
  }

  return null;
}

function scheduleContextFromForm(formData: FormData) {
  const postedClinicId = requiredString(formData.get("clinicId"));
  const postedDate = requiredString(formData.get("date"));
  const postedDateTo = requiredString(formData.get("dateTo"));
  const postedProviderId = requiredString(formData.get("providerFilter"));
  const postedStatus = requiredString(formData.get("statusFilter"));

  return {
    clinicId: postedClinicId || null,
    date: postedDate || null,
    dateTo: postedDateTo || null,
    providerId: postedProviderId === "all" ? null : postedProviderId,
    status: postedStatus === "all" ? null : postedStatus,
  };
}

async function writeAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: "Appointment",
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

function vietnamDateInput(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function isBeforeTodayInVietnam(date: Date) {
  return vietnamDateInput(date) < vietnamDateInput(new Date());
}

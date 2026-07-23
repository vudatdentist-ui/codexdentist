import "server-only";

import { hasAnyRole, canUseAllClinics, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { AppSession } from "@/lib/session";
import type { TaskInboxItemSummary, TaskInboxWorkspace } from "@/lib/task-inbox-types";

const mutableTaskRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
];

export async function getTaskInboxWorkspace(
  session: AppSession,
): Promise<TaskInboxWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [
      crmActivities,
      overdueInvoices,
      lowStockItems,
      leaveRequests,
      requestedAppointments,
      learningEnrollments,
      notifications,
      workItems,
      chains,
      clinics,
      patients,
      users,
    ] = await Promise.all([
      prisma.crmActivity.findMany({
        where: {
          organizationId: session.organizationId,
          completedAt: null,
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
          dueAt: {
            lte: tomorrow,
          },
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          patient: {
            select: {
              fullName: true,
            },
          },
          lead: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          dueAt: "asc",
        },
        take: 20,
      }),
      prisma.invoice.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          status: {
            notIn: ["PAID", "VOID"],
          },
          dueDate: {
            lt: now,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          patient: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          dueDate: "asc",
        },
        take: 20,
      }),
      prisma.inventoryItem.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
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
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
        },
        orderBy: {
          code: "asc",
        },
        take: 80,
      }),
      prisma.leaveRequest.findMany({
        where: {
          organizationId: session.organizationId,
          status: "REQUESTED",
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
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          staffProfile: {
            include: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
        },
        orderBy: {
          startsAt: "asc",
        },
        take: 20,
      }),
      prisma.appointment.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          status: "REQUESTED",
          startsAt: {
            lte: tomorrow,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          patient: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          startsAt: "asc",
        },
        take: 20,
      }),
      prisma.learningEnrollment.findMany({
        where: {
          organizationId: session.organizationId,
          status: {
            in: ["ASSIGNED", "IN_PROGRESS"],
          },
          userId: session.userId,
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          content: {
            select: {
              title: true,
            },
          },
        },
        orderBy: {
          assignedAt: "asc",
        },
        take: 20,
      }),
      prisma.notification.findMany({
        where: {
          organizationId: session.organizationId,
          AND: [
            {
              OR: [
                {
                  userId: session.userId,
                },
                {
                  clinicId: {
                    in: clinicIds,
                  },
                },
                {
                  clinicId: null,
                  userId: null,
                },
              ],
            },
            {
              OR: [
                {
                  status: {
                    in: ["DRAFT", "SCHEDULED", "FAILED"],
                  },
                },
                {
                  channel: "IN_APP",
                  status: "SENT",
                },
              ],
            },
          ],
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          patient: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 30,
      }),
      prisma.workItem.findMany({
        where: {
          organizationId: session.organizationId,
          status: {
            not: "DONE",
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
            {
              assignedToId: session.userId,
            },
          ],
        },
        include: {
          clinic: {
            select: {
              name: true,
            },
          },
          patient: {
            select: {
              fullName: true,
            },
          },
          assignedTo: {
            select: {
              fullName: true,
            },
          },
        },
        orderBy: [
          {
            dueAt: "asc",
          },
          {
            createdAt: "asc",
          },
        ],
        take: 60,
      }),
      prisma.chain.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
          clinics: {
            some: {
              id: {
                in: clinicIds,
              },
            },
          },
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.clinic.findMany({
        where: {
          id: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          name: true,
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
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          clinicId: true,
        },
        orderBy: {
          fullName: "asc",
        },
        take: 400,
      }),
      prisma.user.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
          role: {
            not: "PATIENT",
          },
        },
        select: {
          id: true,
          fullName: true,
          role: true,
          clinics: {
            select: {
              clinicId: true,
            },
          },
        },
        orderBy: {
          fullName: "asc",
        },
      }),
    ]);

    const lowStock = lowStockItems.filter(
      (item) => Number(item.onHandQuantity) <= Number(item.minimumStock),
    );
    const items: TaskInboxItemSummary[] = [
      ...workItems.map((task) => ({
        id: `work-${task.id}`,
        sourceId: task.id,
        kind: "notification" as const,
        priority:
          task.priority === "high"
            ? ("high" as const)
            : task.priority === "low"
              ? ("low" as const)
              : ("medium" as const),
        title: task.title,
        detail: task.detail ?? "Manual task",
        href: "/dashboard",
        dueAt: task.dueAt ? vietnamDateTime(task.dueAt) : null,
        patientName: task.patient?.fullName ?? null,
        clinicName: task.clinic?.name ?? null,
        status: task.status,
        assignedToName: task.assignedTo?.fullName ?? null,
        actionable: true,
        createdAt: vietnamDateTime(task.createdAt),
        channel: "IN_APP",
        actionUrl: "/dashboard",
      })),
      ...crmActivities.map((activity) => ({
        id: `crm-${activity.id}`,
        sourceId: activity.id,
        kind: "crm" as const,
        priority: isPast(activity.dueAt, now) ? ("high" as const) : ("medium" as const),
        title: activity.subject,
        detail: `${activity.type} ${activity.channel ?? ""}`.trim(),
        href: "/crm",
        dueAt: activity.dueAt ? vietnamDateTime(activity.dueAt) : null,
        patientName: activity.patient?.fullName ?? activity.lead?.name ?? null,
        clinicName: activity.clinic?.name ?? null,
        status: "OPEN",
        assignedToName: null,
        actionable: false,
        createdAt: null,
        channel: null,
        actionUrl: "/crm",
      })),
      ...overdueInvoices.map((invoice) => ({
        id: `billing-${invoice.id}`,
        sourceId: invoice.id,
        kind: "billing" as const,
        priority: "high" as const,
        title: `Overdue ${invoice.invoiceNo}`,
        detail: `${formatAmount(Number(invoice.amount) - Number(invoice.paidAmount))}`,
        href: "/billing",
        dueAt: vietnamDate(invoice.dueDate),
        patientName: invoice.patient.fullName,
        clinicName: invoice.clinic.name,
        status: invoice.status,
        assignedToName: null,
        actionable: false,
        createdAt: null,
        channel: null,
        actionUrl: "/billing",
      })),
      ...lowStock.slice(0, 20).map((item) => ({
        id: `inventory-${item.id}`,
        sourceId: item.id,
        kind: "inventory" as const,
        priority: Number(item.onHandQuantity) <= 0 ? ("high" as const) : ("medium" as const),
        title: `Low stock: ${item.code}`,
        detail: `${item.name}: ${Number(item.onHandQuantity)}/${Number(item.minimumStock)} ${item.unit}`,
        href: "/inventory",
        dueAt: null,
        patientName: null,
        clinicName: item.clinic?.name ?? null,
        status: "LOW_STOCK",
        assignedToName: null,
        actionable: false,
        createdAt: null,
        channel: null,
        actionUrl: "/inventory",
      })),
      ...leaveRequests.map((request) => ({
        id: `leave-${request.id}`,
        sourceId: request.id,
        kind: "hr" as const,
        priority: "medium" as const,
        title: `Leave request: ${request.staffProfile.user.fullName}`,
        detail: `${request.leaveType} ${vietnamDate(request.startsAt)} - ${vietnamDate(request.endsAt)}`,
        href: "/staff",
        dueAt: vietnamDate(request.startsAt),
        patientName: null,
        clinicName: request.clinic?.name ?? null,
        status: request.status,
        assignedToName: null,
        actionable: false,
        createdAt: null,
        channel: null,
        actionUrl: "/staff",
      })),
      ...requestedAppointments.map((appointment) => ({
        id: `schedule-${appointment.id}`,
        sourceId: appointment.id,
        kind: "schedule" as const,
        priority: "medium" as const,
        title: `Appointment request: ${appointment.patient.fullName}`,
        detail: appointment.reason,
        href: "/schedule",
        dueAt: vietnamDateTime(appointment.startsAt),
        patientName: appointment.patient.fullName,
        clinicName: appointment.clinic.name,
        status: appointment.status,
        assignedToName: null,
        actionable: false,
        createdAt: null,
        channel: null,
        actionUrl: "/schedule",
      })),
      ...learningEnrollments.map((enrollment) => ({
        id: `learning-${enrollment.id}`,
        sourceId: enrollment.id,
        kind: "learning" as const,
        priority: "low" as const,
        title: enrollment.content.title,
        detail: "Learning assignment",
        href: "/learning",
        dueAt: vietnamDate(enrollment.assignedAt),
        patientName: null,
        clinicName: enrollment.clinic?.name ?? null,
        status: enrollment.status,
        assignedToName: null,
        actionable: false,
        createdAt: null,
        channel: null,
        actionUrl: "/learning",
      })),
      ...notifications.map((notification) => {
        const actionUrl = metadataActionUrl(notification.metadata);

        return {
          id: `notification-${notification.id}`,
          sourceId: notification.id,
          kind: "notification" as const,
          priority: notification.status === "FAILED" ? ("high" as const) : metadataPriority(notification.metadata),
          title: notification.subject ?? notification.templateKey ?? "Notification",
          detail: notification.body,
          href: actionUrl ?? (notification.templateKey === "PAYMENT_PLAN" ? "/billing" : "/dashboard"),
          dueAt: notification.scheduledAt ? vietnamDateTime(notification.scheduledAt) : null,
          patientName: notification.patient?.fullName ?? null,
          clinicName: notification.clinic?.name ?? null,
          status: notification.status,
          assignedToName: null,
          actionable: Boolean(actionUrl),
          createdAt: vietnamDateTime(notification.createdAt),
          channel: notification.channel,
          actionUrl,
        };
      }),
    ];

    return {
      source: "database",
      canMutate: hasAnyRole(session, mutableTaskRoles),
      message: null,
      generatedAt: vietnamDateTime(now),
      chains,
      clinics,
      patients: patients.map((patient) => ({
        id: patient.id,
        name: patient.fullName,
        phone: patient.phone,
        clinicId: patient.clinicId,
      })),
      users: users.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        clinicIds: user.clinics.map((clinic) => clinic.clinicId),
      })),
      items: items
        .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
        .slice(0, 60),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "task-inbox");
    return {
      source: "demo",
      canMutate: false,
      message:
        "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
      generatedAt: vietnamDateTime(new Date()),
      chains: [],
      clinics: [],
      patients: [],
      users: [],
      items: [],
    };
  }
}

function metadataActionUrl(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || !("actionUrl" in metadata)) {
    return null;
  }

  const value = (metadata as { actionUrl?: unknown }).actionUrl;
  return typeof value === "string" && value.startsWith("/") ? value : null;
}

function metadataPriority(metadata: unknown): TaskInboxItemSummary["priority"] {
  if (!metadata || typeof metadata !== "object" || !("priority" in metadata)) {
    return "low";
  }

  const value = (metadata as { priority?: unknown }).priority;
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function priorityRank(priority: string) {
  const ranks: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return ranks[priority] ?? 3;
}

function isPast(value: Date | null, now: Date) {
  return Boolean(value && value.getTime() < now.getTime());
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 0,
    style: "currency",
    currency: "VND",
  }).format(Math.max(value, 0));
}

function vietnamDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

function vietnamDateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(value);
}

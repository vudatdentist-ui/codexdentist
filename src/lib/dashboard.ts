import "server-only";

import { clinics as demoClinics, formatVnd } from "@/lib/data";
import { prisma } from "@/lib/prisma";
import { assertDemoFallbackAllowed } from "@/lib/runtime-guards";
import type { DashboardWorkspace } from "@/lib/dashboard-types";
import type { AppSession } from "@/lib/session";

export async function getDashboardWorkspace(
  session: AppSession,
): Promise<DashboardWorkspace> {
  try {
    const clinicIds = allowedClinicIds(session);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date());
    const dayStart = new Date(`${today}T00:00:00+07:00`);
    const dayEnd = new Date(`${today}T23:59:59+07:00`);
    const now = new Date();

    const [
      clinics,
      chairs,
      appointments,
      receipts,
      invoices,
      patientsMissingConsent,
      lowStockItems,
      pendingNotifications,
      failedNotifications,
      openWorkItems,
      openCrmActivities,
      openAttendanceLogs,
      providers,
    ] = await Promise.all([
      prisma.clinic.findMany({
        where: {
          organizationId: session.organizationId,
          id: {
            in: clinicIds,
          },
        },
        select: {
          id: true,
          chainId: true,
          chain: {
            select: {
              name: true,
            },
          },
          name: true,
          city: true,
        },
        orderBy: {
          name: "asc",
        },
      }),
      prisma.chair.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          active: true,
        },
        select: {
          clinicId: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          startsAt: {
            gte: dayStart,
            lte: dayEnd,
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
          provider: {
            select: {
              id: true,
              fullName: true,
              role: true,
            },
          },
        },
        orderBy: {
          startsAt: "asc",
        },
      }),
      prisma.receipt.findMany({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          receivedAt: {
            gte: dayStart,
            lte: dayEnd,
          },
        },
        select: {
          clinicId: true,
          amount: true,
        },
      }),
      prisma.invoice.findMany({
        where: {
          clinicId: {
            in: clinicIds,
          },
          patient: {
            organizationId: session.organizationId,
          },
        },
        select: {
          amount: true,
          paidAmount: true,
          dueDate: true,
          status: true,
        },
      }),
      prisma.patient.count({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          OR: [
            {
              consents: {
                none: {},
              },
            },
            {
              consents: {
                some: {
                  status: {
                    not: "GRANTED",
                  },
                },
              },
            },
          ],
        },
      }),
      prisma.inventoryItem.count({
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
          onHandQuantity: {
            lte: prisma.inventoryItem.fields.minimumStock,
          },
        },
      }),
      prisma.notification.count({
        where: {
          organizationId: session.organizationId,
          status: {
            in: ["DRAFT", "SCHEDULED"],
          },
        },
      }),
      prisma.notification.count({
        where: {
          organizationId: session.organizationId,
          status: "FAILED",
        },
      }),
      prisma.workItem.count({
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
          ],
        },
      }),
      prisma.crmActivity.count({
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
        },
      }),
      prisma.attendanceLog.count({
        where: {
          organizationId: session.organizationId,
          clinicId: {
            in: clinicIds,
          },
          clockOutAt: null,
        },
      }),
      prisma.user.findMany({
        where: {
          organizationId: session.organizationId,
          active: true,
          role: {
            in: ["DENTIST", "HYGIENIST", "CLINIC_MANAGER"],
          },
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
          fullName: true,
          role: true,
        },
      }),
    ]);

    const chairCount = chairs.length;
    const completedAppointments = appointments.filter(
      (appointment) => appointment.status === "COMPLETED",
    ).length;
    const activeAppointments = appointments.filter((appointment) =>
      ["ARRIVED", "IN_CHAIR"].includes(appointment.status),
    ).length;
    const collectedToday = receipts.reduce(
      (total, receipt) => total + Number(receipt.amount),
      0,
    );
    const openBalance = invoices
      .filter((invoice) => invoice.status !== "PAID" && invoice.status !== "VOID")
      .reduce(
        (total, invoice) => total + Number(invoice.amount) - Number(invoice.paidAmount),
        0,
      );
    const overdueInvoices = invoices.filter(
      (invoice) =>
        invoice.status !== "PAID" &&
        invoice.status !== "VOID" &&
        invoice.dueDate < now,
    ).length;
    const utilization = Math.min(
      100,
      Math.round((activeAppointments / Math.max(chairCount, 1)) * 100),
    );
    const flowStatuses = [
      ["REQUESTED", "Yêu cầu"],
      ["CONFIRMED", "Đã hẹn"],
      ["ARRIVED", "Đã đến"],
      ["IN_CHAIR", "Đang điều trị"],
      ["COMPLETED", "Hoàn tất"],
    ] as const;
    const providerLoads = providers
      .map((provider) => {
        const providerAppointments = appointments.filter(
          (appointment) => appointment.provider.id === provider.id,
        );

        return {
          providerId: provider.id,
          name: provider.fullName,
          role: provider.role,
          appointmentCount: providerAppointments.length,
          activeCount: providerAppointments.filter((appointment) =>
            ["ARRIVED", "IN_CHAIR"].includes(appointment.status),
          ).length,
        };
      })
      .filter((provider) => provider.appointmentCount > 0)
      .sort((left, right) => right.appointmentCount - left.appointmentCount)
      .slice(0, 8);

    return {
      source: "database",
      message: clinics.length
        ? null
        : "Chưa có dữ liệu trong phạm vi hiện tại.",
      generatedAt: vietnamDateTime(now),
      metrics: [
        {
          label: "Lịch hẹn hôm nay",
          value: String(appointments.length),
          detail: `${activeAppointments} đang xử lý`,
          tone: "blue",
        },
        {
          label: "Hiệu suất ghế",
          value: `${utilization}%`,
          detail: `${activeAppointments}/${chairCount} ghế đang dùng`,
          tone: "teal",
        },
        {
          label: "Đã thu hôm nay",
          value: formatVnd(collectedToday),
          detail: `${receipts.length} phiếu thu`,
          tone: "green",
        },
        {
          label: "Công nợ mở",
          value: formatVnd(openBalance),
          detail: `${overdueInvoices} hóa đơn quá hạn`,
          tone: overdueInvoices > 0 ? "rose" : "violet",
        },
      ],
      flow: flowStatuses.map(([status, label]) => ({
        key: status,
        label,
        count: appointments.filter((appointment) => appointment.status === status).length,
      })),
      clinicSummaries: clinics.map((clinic) => {
        const clinicAppointments = appointments.filter(
          (appointment) => appointment.clinicId === clinic.id,
        );
        const clinicChairs = chairs.filter((chair) => chair.clinicId === clinic.id).length;
        const clinicActive = clinicAppointments.filter((appointment) =>
          ["ARRIVED", "IN_CHAIR"].includes(appointment.status),
        ).length;

        return {
          clinicId: clinic.id,
          chainId: clinic.chainId,
          chainName: clinic.chain?.name ?? null,
          name: clinic.name,
          city: clinic.city,
          chairs: clinicChairs,
          providers: providers.length,
          todayAppointments: clinicAppointments.length,
          inChair: clinicAppointments.filter((appointment) => appointment.status === "IN_CHAIR").length,
          completed: clinicAppointments.filter((appointment) => appointment.status === "COMPLETED").length,
          utilization: Math.min(100, Math.round((clinicActive / Math.max(clinicChairs, 1)) * 100)),
          collectedToday: receipts
            .filter((receipt) => receipt.clinicId === clinic.id)
            .reduce((total, receipt) => total + Number(receipt.amount), 0),
        };
      }),
      risks: [
        {
          label: "Hóa đơn quá hạn",
          value: String(overdueInvoices),
          detail: "Cần gọi thu hoặc lập kế hoạch thanh toán",
          tone: overdueInvoices > 0 ? "rose" : "green",
          href: "/billing",
        },
        {
          label: "Đồng thuận cần xử lý",
          value: String(patientsMissingConsent),
          detail: "Bệnh nhân chưa có consent hợp lệ",
          tone: patientsMissingConsent > 0 ? "amber" : "green",
          href: "/patients",
        },
        {
          label: "Tồn kho thấp",
          value: String(lowStockItems),
          detail: "Vật tư bằng hoặc dưới định mức",
          tone: lowStockItems > 0 ? "amber" : "green",
          href: "/inventory",
        },
        {
          label: "Thông báo lỗi",
          value: String(failedNotifications),
          detail: `${pendingNotifications} thông báo đang chờ`,
          tone: failedNotifications > 0 ? "rose" : "blue",
          href: "/dashboard",
        },
        {
          label: "Công việc đang mở",
          value: String(openWorkItems),
          detail: `${openCrmActivities} việc CRM, ${openAttendanceLogs} chấm công mở`,
          tone: openWorkItems + openCrmActivities > 0 ? "violet" : "green",
          href: "/dashboard",
        },
      ],
      providerLoads,
      appointments: appointments.slice(0, 10).map((appointment) => ({
        id: appointment.id,
        clinicId: appointment.clinicId,
        time: vietnamTime(appointment.startsAt),
        patientName: appointment.patient.fullName,
        providerName: appointment.provider.fullName,
        clinicName: appointment.clinic.name,
        procedure: appointment.reason,
        status: appointment.status,
      })),
    };
  } catch (error) {
    assertDemoFallbackAllowed(error, "dashboard");
    return demoDashboardWorkspace(session);
  }
}

function demoDashboardWorkspace(session: AppSession): DashboardWorkspace {
  const allowedIds = new Set(session.clinicIds);
  const clinics = demoClinics.filter((clinic) => allowedIds.has(clinic.id));
  const todayVisits = clinics.reduce((total, clinic) => total + clinic.todayVisits, 0);
  const collection = clinics.reduce((total, clinic) => total + clinic.collection, 0);

  return {
    source: "demo",
    message:
      "Chưa tải được dữ liệu. Vui lòng thử lại sau.",
    generatedAt: "Demo snapshot",
    metrics: [
      { label: "Lịch hẹn hôm nay", value: String(todayVisits), detail: null, tone: "blue" },
      { label: "Hiệu suất ghế", value: "0%", detail: null, tone: "teal" },
      { label: "Đã thu hôm nay", value: formatVnd(collection), detail: null, tone: "green" },
      { label: "Công nợ mở", value: formatVnd(0), detail: null, tone: "violet" },
    ],
    flow: [
      { key: "REQUESTED", label: "Yêu cầu", count: 0 },
      { key: "CONFIRMED", label: "Đã hẹn", count: todayVisits },
      { key: "ARRIVED", label: "Đã đến", count: 0 },
      { key: "IN_CHAIR", label: "Đang điều trị", count: 0 },
      { key: "COMPLETED", label: "Hoàn tất", count: 0 },
    ],
    clinicSummaries: clinics.map((clinic) => ({
      clinicId: clinic.id,
      chainId: clinic.chainId ?? null,
      chainName: clinic.chainName ?? null,
      name: clinic.name,
      city: clinic.city,
      chairs: clinic.chairs,
      providers: clinic.doctors,
      todayAppointments: clinic.todayVisits,
      inChair: 0,
      completed: 0,
      utilization: clinic.utilization,
      collectedToday: clinic.collection,
    })),
    risks: [],
    providerLoads: [],
    appointments: [],
  };
}

function allowedClinicIds(session: AppSession) {
  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function vietnamTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}

"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  parseEndOfDateInVietnam,
  requiredString,
} from "@/lib/form-validation";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const mutableTaskRoles: AppRole[] = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
];

export async function createWorkItemAction(formData: FormData) {
  const session = await requireViewSession("dashboard");
  const redirectTo = workRedirect(formData);

  if (!canWriteTasks(session)) {
    redirect(withNotice(redirectTo, "task-denied"));
  }

  const title = requiredString(formData.get("title"));
  const detail = optionalString(formData.get("detail"));
  const patientId = optionalString(formData.get("patientId"));
  const assignedToId = optionalString(formData.get("assignedToId"));
  const clinicId = optionalString(formData.get("clinicId"));
  const priority = normalizePriority(formData.get("priority"));
  const dueAt = parseEndOfDateInVietnam(formData.get("dueAt"), () => new Date());

  if (!title || dueAt === "invalid") {
    redirect(withNotice(redirectTo, "task-missing"));
  }

  try {
    const scopedClinicId = await resolveClinicId(session, clinicId, patientId);

    if (!scopedClinicId && !canUseAllClinics(session)) {
      redirect(withNotice(redirectTo, "task-denied"));
    }

    if (assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: {
          id: assignedToId,
          organizationId: session.organizationId,
          active: true,
        },
        select: { id: true },
      });

      if (!assignee) {
        redirect(withNotice(redirectTo, "task-missing"));
      }
    }

    const task = await prisma.workItem.create({
      data: {
        organizationId: session.organizationId,
        clinicId: scopedClinicId,
        patientId,
        assignedToId,
        createdById: databaseActorId(session.userId),
        sourceKind: "manual",
        priority,
        status: "OPEN",
        title,
        detail,
        dueAt,
      },
      select: { id: true },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "work_item.created",
        entityType: "WorkItem",
        entityId: task.id,
        metadata: { patientId, assignedToId, priority } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    redirect(withNotice(redirectTo, "task-database"));
  }

  revalidateWorkSurfaces();
  redirect(withNotice(redirectTo, "task-created"));
}

export async function completeWorkItemAction(formData: FormData) {
  const session = await requireViewSession("dashboard");
  const redirectTo = workRedirect(formData);

  if (!canWriteTasks(session)) {
    redirect(withNotice(redirectTo, "task-denied"));
  }

  const workItemId = requiredString(formData.get("workItemId"));
  if (!workItemId) {
    redirect(withNotice(redirectTo, "task-missing"));
  }

  try {
    const task = await prisma.workItem.findFirst({
      where: {
        id: workItemId,
        organizationId: session.organizationId,
        OR: [
          { clinicId: null },
          { clinicId: { in: allowedClinicIds(session) } },
        ],
      },
      select: { id: true },
    });

    if (!task) {
      redirect(withNotice(redirectTo, "task-missing"));
    }

    await prisma.workItem.update({
      where: { id: task.id },
      data: {
        status: "DONE",
        completedAt: new Date(),
        completedById: databaseActorId(session.userId),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "work_item.completed",
        entityType: "WorkItem",
        entityId: task.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    redirect(withNotice(redirectTo, "task-database"));
  }

  revalidateWorkSurfaces();
  redirect(withNotice(redirectTo, "task-completed"));
}

export async function retryFailedNotificationAction(formData: FormData) {
  const session = await requireViewSession("dashboard");
  const redirectTo = workRedirect(formData);

  if (!canWriteTasks(session)) {
    redirect(withNotice(redirectTo, "task-denied"));
  }

  const notificationId = requiredString(formData.get("notificationId"));
  if (!notificationId) {
    redirect(withNotice(redirectTo, "task-missing"));
  }

  try {
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        organizationId: session.organizationId,
        status: "FAILED",
        OR: [
          { clinicId: null },
          { clinicId: { in: allowedClinicIds(session) } },
        ],
      },
      select: { id: true },
    });

    if (!notification) {
      redirect(withNotice(redirectTo, "notification-not-found"));
    }

    await prisma.notification.update({
      where: { id: notification.id },
      data: {
        status: "SCHEDULED",
        scheduledAt: new Date(),
        sentAt: null,
        failedReason: null,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "notification.retry_scheduled",
        entityType: "Notification",
        entityId: notification.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    redirect(withNotice(redirectTo, "task-database"));
  }

  revalidateWorkSurfaces();
  redirect(withNotice(redirectTo, "notification-retry-scheduled"));
}

async function resolveClinicId(
  session: AppSession,
  clinicId: string | null,
  patientId: string | null,
) {
  if (patientId) {
    const patient = await prisma.patient.findFirst({
      where: {
        id: patientId,
        organizationId: session.organizationId,
        clinicId: { in: allowedClinicIds(session) },
      },
      select: { clinicId: true },
    });
    return patient?.clinicId ?? null;
  }

  if (clinicId && allowedClinicIds(session).includes(clinicId)) return clinicId;
  return session.activeClinicId ?? allowedClinicIds(session)[0] ?? null;
}

function canWriteTasks(session: AppSession) {
  return hasAnyRole(session, mutableTaskRoles);
}

function normalizePriority(value: FormDataEntryValue | null) {
  const priority = requiredString(value);
  return priority === "high" || priority === "medium" || priority === "low"
    ? priority
    : "medium";
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) return session.clinicIds;
  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function workRedirect(formData: FormData) {
  return optionalString(formData.get("redirectTo")) === "/work" ? "/work" : "/today";
}

function withNotice(path: string, notice: string) {
  return `${path}?notice=${encodeURIComponent(notice)}`;
}

function revalidateWorkSurfaces() {
  revalidatePath("/today");
  revalidatePath("/work");
  revalidatePath("/dashboard");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

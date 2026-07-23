"use server";

import type { Prisma, UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  optionalString,
  requiredString,
} from "@/lib/form-validation";
import { canUseAllClinics, hasAnyRole, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const senderRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];
const staffRoles = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
] as const;

export async function createInAppNotificationAction(formData: FormData) {
  const session = await requireViewSession("dashboard");
  const redirectTo = safeRedirectPath(optionalString(formData.get("redirectTo")) ?? "/dashboard");

  if (!hasAnyRole(session, senderRoles)) {
    redirect(`${redirectTo}?notice=notification-denied`);
  }

  const subject = requiredString(formData.get("subject"));
  const body = requiredString(formData.get("body"));
  const actionUrl = optionalString(formData.get("actionUrl"));
  const priority = normalizePriority(formData.get("priority"));
  const targetUserIds = uniqueValues(formData.getAll("targetUserIds"));
  const targetRoles = uniqueValues(formData.getAll("targetRoles")).filter(isStaffRole);
  const targetClinicIds = uniqueValues(formData.getAll("targetClinicIds"));
  const targetChainIds = uniqueValues(formData.getAll("targetChainIds"));
  const sendToSystem = checkboxValue(formData.get("targetSystem"));

  if (!subject || !body) {
    redirect(`${redirectTo}?notice=notification-missing`);
  }

  if (
    targetUserIds.length === 0 &&
    targetRoles.length === 0 &&
    targetClinicIds.length === 0 &&
    targetChainIds.length === 0 &&
    !sendToSystem
  ) {
    redirect(`${redirectTo}?notice=notification-target-missing`);
  }

  try {
    const recipients = await resolveRecipients(session, {
      sendToSystem,
      targetChainIds,
      targetClinicIds,
      targetRoles,
      targetUserIds,
    });

    if (recipients.length === 0) {
      redirect(`${redirectTo}?notice=notification-target-missing`);
    }

    const createdAt = new Date();
    const metadata = {
      actionUrl: actionUrl && actionUrl.startsWith("/") ? actionUrl : null,
      createdById: session.userId,
      createdByName: session.fullName,
      priority,
      targets: {
        system: sendToSystem,
        chainIds: targetChainIds,
        clinicIds: targetClinicIds,
        roles: targetRoles,
        userIds: targetUserIds,
      },
      type: "IN_APP_ANNOUNCEMENT",
    } satisfies Prisma.InputJsonObject;

    await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        organizationId: session.organizationId,
        clinicId: recipient.primaryClinicId,
        userId: recipient.id,
        channel: "IN_APP",
        status: "SENT",
        recipient: recipient.email,
        subject,
        body,
        sentAt: createdAt,
        metadata,
      })),
      skipDuplicates: true,
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "notification.in_app_broadcast",
        entityType: "Notification",
        metadata: {
          priority,
          recipientCount: recipients.length,
          subject,
          targets: metadata.targets,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect(`${redirectTo}?notice=notification-database`);
  }

  revalidatePath("/");
  redirect(`${redirectTo}?notice=notification-sent`);
}

async function resolveRecipients(
  session: AppSession,
  input: {
    sendToSystem: boolean;
    targetChainIds: string[];
    targetClinicIds: string[];
    targetRoles: UserRole[];
    targetUserIds: string[];
  },
) {
  const canTargetAllClinics = canUseAllClinics(session);
  const allowedClinicIds = new Set(session.clinicIds);
  const chainClinicIds =
    input.targetChainIds.length > 0
      ? (
          await prisma.clinic.findMany({
            where: {
              organizationId: session.organizationId,
              active: true,
              chainId: {
                in: input.targetChainIds,
              },
              ...(canTargetAllClinics ? {} : { id: { in: session.clinicIds } }),
            },
            select: {
              id: true,
            },
          })
        ).map((clinic) => clinic.id)
      : [];
  const clinicTargets = uniqueStrings([
    ...input.targetClinicIds.filter((id) => allowedClinicIds.has(id)),
    ...chainClinicIds,
  ]);

  const users = await prisma.user.findMany({
    where: {
      organizationId: session.organizationId,
      active: true,
      role: {
        not: "PATIENT",
      },
      OR: [
        input.sendToSystem ? {} : undefined,
        input.targetUserIds.length > 0
          ? {
              id: {
                in: input.targetUserIds,
              },
            }
          : undefined,
        input.targetRoles.length > 0
          ? {
              role: {
                in: input.targetRoles,
              },
            }
          : undefined,
        clinicTargets.length > 0
          ? {
              clinics: {
                some: {
                  clinicId: {
                    in: clinicTargets,
                  },
                },
              },
            }
          : undefined,
      ].filter(Boolean) as Prisma.UserWhereInput[],
    },
    include: {
      clinics: {
        select: {
          clinicId: true,
        },
      },
    },
    orderBy: {
      fullName: "asc",
    },
  });

  return users
    .filter((user) => {
      if (canTargetAllClinics) {
        return true;
      }

      return (
        user.clinics.length === 0 ||
        user.clinics.some((clinic) => allowedClinicIds.has(clinic.clinicId))
      );
    })
    .map((user) => ({
      email: user.email,
      id: user.id,
      primaryClinicId:
        (canTargetAllClinics
          ? user.clinics[0]?.clinicId
          : user.clinics.find((clinic) => allowedClinicIds.has(clinic.clinicId))?.clinicId) ?? null,
    }));
}

function checkboxValue(value: FormDataEntryValue | null) {
  return value === "on" || value === "true" || value === "1" || value === "yes";
}

function normalizePriority(value: FormDataEntryValue | null) {
  const priority = requiredString(value);

  return priority === "high" || priority === "low" ? priority : "medium";
}

function uniqueValues(values: FormDataEntryValue[]) {
  return uniqueStrings(
    values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean),
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isStaffRole(value: string): value is UserRole {
  return staffRoles.includes(value as (typeof staffRoles)[number]);
}

function safeRedirectPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

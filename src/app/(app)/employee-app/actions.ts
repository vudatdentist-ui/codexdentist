"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import {
  databaseActorId,
  parseDateInVietnam,
  parseEndOfDateInVietnam,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import { ensureStaffProfiles } from "@/lib/payroll";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const currentStaffLeaveTypes = new Set(["ANNUAL", "SICK", "UNPAID", "TRAINING"]);
const currentStaffOutStatuses = new Set(["NORMAL", "EARLY", "OVERTIME", "EMERGENCY"]);

export async function clockInCurrentStaffAction(formData: FormData) {
  const session = await requireViewSession("employee-app");
  const profile = await currentStaffProfile(session);

  if (!profile) {
    redirect("/employee-app?notice=staff-profile-missing");
  }

  const clinicId = preferredClinicId(session, profile.clinicId);

  if (!clinicId) {
    redirect("/employee-app?notice=staff-profile-missing");
  }

  try {
    const openLog = await prisma.attendanceLog.findFirst({
      where: {
        staffProfileId: profile.id,
        clockOutAt: null,
      },
      select: {
        id: true,
      },
    });

    if (openLog) {
      redirect("/employee-app?notice=staff-attendance-open");
    }

    const log = await prisma.attendanceLog.create({
      data: {
        organizationId: session.organizationId,
        clinicId,
        staffProfileId: profile.id,
        clockInAt: new Date(),
        source: "STAFF",
        note: requiredString(formData.get("note")) || null,
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "employee_app.clock_in",
        entityType: "AttendanceLog",
        entityId: log.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/employee-app?notice=staff-database");
  }

  revalidateEmployeeApp();
  redirect("/employee-app?notice=staff-clocked-in");
}

export async function clockOutCurrentStaffAction(formData: FormData) {
  const session = await requireViewSession("employee-app");
  const profile = await currentStaffProfile(session);

  if (!profile) {
    redirect("/employee-app?notice=staff-profile-missing");
  }

  try {
    const log = await prisma.attendanceLog.findFirst({
      where: {
        organizationId: session.organizationId,
        staffProfileId: profile.id,
        clinicId: {
          in: allowedClinicIdsFor(session),
        },
        clockOutAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!log) {
      redirect("/employee-app?notice=staff-attendance-missing");
    }

    await prisma.attendanceLog.update({
      where: {
        id: log.id,
      },
      data: {
        clockOutAt: new Date(),
        outStatus: normalizeOutStatus(formData.get("outStatus")),
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "employee_app.clock_out",
        entityType: "AttendanceLog",
        entityId: log.id,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/employee-app?notice=staff-database");
  }

  revalidateEmployeeApp();
  redirect("/employee-app?notice=staff-clocked-out");
}

export async function createCurrentStaffLeaveRequestAction(formData: FormData) {
  const session = await requireViewSession("employee-app");
  const profile = await currentStaffProfile(session);
  const startsAt = parseDateInVietnam(formData.get("startsAt"));
  const endsAt = parseEndOfDateInVietnam(formData.get("endsAt"), () => new Date());
  const leaveType = normalizeLeaveType(formData.get("leaveType"));
  const hours = parseMoney(formData.get("hours"));

  if (
    !profile ||
    !leaveType ||
    (hours != null && hours <= 0) ||
    startsAt === "invalid" ||
    endsAt === "invalid" ||
    !startsAt ||
    !endsAt ||
    startsAt > endsAt
  ) {
    redirect("/employee-app?notice=staff-leave-missing");
  }

  try {
    const leave = await prisma.leaveRequest.create({
      data: {
        organizationId: session.organizationId,
        clinicId: profile.clinicId,
        staffProfileId: profile.id,
        leaveType,
        status: "REQUESTED",
        startsAt,
        endsAt,
        hours,
        reason: requiredString(formData.get("reason")) || null,
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "employee_app.leave_requested",
        entityType: "LeaveRequest",
        entityId: leave.id,
        metadata: {
          leaveType,
        } as Prisma.InputJsonValue,
      },
    });
  } catch {
    redirect("/employee-app?notice=staff-database");
  }

  revalidateEmployeeApp();
  redirect("/employee-app?notice=staff-leave-created");
}

function normalizeLeaveType(value: FormDataEntryValue | null) {
  const leaveType = requiredString(value).toUpperCase();

  return currentStaffLeaveTypes.has(leaveType) ? leaveType : null;
}

function normalizeOutStatus(value: FormDataEntryValue | null) {
  const outStatus = requiredString(value).toUpperCase();

  return currentStaffOutStatuses.has(outStatus) ? outStatus : "NORMAL";
}

async function currentStaffProfile(session: AppSession) {
  await ensureStaffProfiles(session, { scope: "self" });

  return prisma.staffProfile.findFirst({
    where: {
      organizationId: session.organizationId,
      userId: session.userId,
      active: true,
      user: {
        active: true,
      },
      OR: [
        {
          clinicId: {
            in: allowedClinicIdsFor(session),
          },
        },
        {
          clinicId: null,
        },
      ],
    },
    select: {
      id: true,
      clinicId: true,
    },
  });
}

function preferredClinicId(session: AppSession, profileClinicId: string | null) {
  const allowedClinicIds = allowedClinicIdsFor(session);

  if (profileClinicId && allowedClinicIds.includes(profileClinicId)) {
    return profileClinicId;
  }

  return session.activeClinicId ?? allowedClinicIds[0] ?? null;
}

function allowedClinicIdsFor(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function revalidateEmployeeApp() {
  revalidatePath("/employee-app");
  revalidatePath("/staff");
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

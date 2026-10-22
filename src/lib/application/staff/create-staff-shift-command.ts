import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, parseDateTimeInVietnam, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { scopedStaffProfile, } from "@/lib/application/staff/support";
export async function createStaffShiftCommand(input: {
    session: AppSession;
    staffProfileId: string;
    roleOnShiftInput: string;
    notesInput: string;
    clinicId: string;
    date: string;
    startTime: string;
    endTime: string;
}) {
    const { session, staffProfileId, roleOnShiftInput, notesInput, clinicId, date, startTime, endTime } = input;
    if (!canPerformAction(session, "staff.manage")) {
        failCommand("staff-denied");
    }
    const startsAt = parseDateTimeInVietnam(date, startTime);
    const endsAt = parseDateTimeInVietnam(date, endTime);
    if (!staffProfileId ||
        !clinicId ||
        startsAt === "invalid" ||
        endsAt === "invalid" ||
        startsAt >= endsAt) {
        failCommand("staff-shift-missing");
    }
    if (!allowedClinicIdsFor(session).includes(clinicId)) {
        failCommand("staff-denied");
    }
    const profile = await scopedStaffProfile(session, staffProfileId);
    if (!profile) {
        failCommand("staff-profile-missing");
    }
    const shift = await prisma.staffShift.create({
        data: {
            organizationId: session.organizationId,
            clinicId,
            staffProfileId: profile.id,
            status: "SCHEDULED",
            roleOnShift: roleOnShiftInput || null,
            startsAt,
            endsAt,
            notes: notesInput || null,
        },
        select: {
            id: true,
        },
    });
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "staff_shift.created",
            entityType: "StaffShift",
            entityId: shift.id,
            metadata: {
                staffProfileId: profile.id,
                clinicId,
            } as Prisma.InputJsonValue,
        },
    });
}

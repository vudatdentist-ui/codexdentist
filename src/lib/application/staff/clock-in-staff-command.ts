import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { scopedStaffProfile, } from "@/lib/application/staff/support";
export async function clockInStaffCommand(input: {
    session: AppSession;
    staffProfileId: string;
    noteInput: string;
    clinicId: string;
}) {
    const { session, staffProfileId, noteInput, clinicId } = input;
    if (!canPerformAction(session, "staff.manage")) {
        failCommand("staff-denied");
    }
    if (!staffProfileId || !clinicId || !allowedClinicIdsFor(session).includes(clinicId)) {
        failCommand("staff-profile-missing");
    }
    const profile = await scopedStaffProfile(session, staffProfileId);
    if (!profile) {
        failCommand("staff-profile-missing");
    }
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
        failCommand("staff-attendance-open");
    }
    const log = await prisma.attendanceLog.create({
        data: {
            organizationId: session.organizationId,
            clinicId,
            staffProfileId: profile.id,
            clockInAt: new Date(),
            source: "STAFF",
            note: noteInput || null,
        },
        select: {
            id: true,
        },
    });
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "attendance.clock_in",
            entityType: "AttendanceLog",
            entityId: log.id,
        },
    });
}

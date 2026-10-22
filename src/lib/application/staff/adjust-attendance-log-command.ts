import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, parseDateTimeInVietnam, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
export async function adjustAttendanceLogCommand(input: {
    attendanceLogId: string;
    session: AppSession;
    outStatusInput: string;
    noteInput: string;
    clockInDate: string;
    clockInTime: string;
    clockOutDate: string;
    clockOutTime: string;
}) {
    const { attendanceLogId, session, outStatusInput, noteInput, clockInDate, clockInTime, clockOutDate, clockOutTime } = input;
    if (!canPerformAction(session, "staff.manage")) {
        failCommand("staff-denied");
    }
    const clockInAt = parseDateTimeInVietnam(clockInDate, clockInTime);
    const clockOutAt = clockOutDate && clockOutTime
        ? parseDateTimeInVietnam(clockOutDate, clockOutTime)
        : null;
    if (!attendanceLogId ||
        clockInAt === "invalid" ||
        clockOutAt === "invalid" ||
        (clockOutAt && clockInAt >= clockOutAt)) {
        failCommand("staff-attendance-missing");
    }
    const log = await prisma.attendanceLog.findFirst({
        where: {
            id: attendanceLogId,
            organizationId: session.organizationId,
            clinicId: {
                in: allowedClinicIdsFor(session),
            },
        },
        select: {
            id: true,
        },
    });
    if (!log) {
        failCommand("staff-attendance-missing");
    }
    await prisma.$transaction(async (tx) => {
        await tx.attendanceLog.update({
            where: {
                id: log.id,
            },
            data: {
                clockInAt,
                clockOutAt,
                outStatus: outStatusInput || "ADJUSTED",
                note: noteInput || null,
                adjusted: true,
            },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "attendance.adjusted",
                entityType: "AttendanceLog",
                entityId: log.id,
            },
        });
    });
}

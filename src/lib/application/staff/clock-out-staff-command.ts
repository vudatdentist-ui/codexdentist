import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
export async function clockOutStaffCommand(input: {
    attendanceLogId: string;
    session: AppSession;
    outStatusInput: string;
}) {
    const { attendanceLogId, session, outStatusInput } = input;
    if (!canPerformAction(session, "staff.manage")) {
        failCommand("staff-denied");
    }
    const log = await prisma.attendanceLog.findFirst({
        where: {
            id: attendanceLogId,
            organizationId: session.organizationId,
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
        failCommand("staff-attendance-missing");
    }
    await prisma.attendanceLog.update({
        where: {
            id: log.id,
        },
        data: {
            clockOutAt: new Date(),
            outStatus: outStatusInput || "NORMAL",
        },
    });
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "attendance.clock_out",
            entityType: "AttendanceLog",
            entityId: log.id,
        },
    });
}

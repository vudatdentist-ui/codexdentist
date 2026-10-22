import "server-only";
import { accessibleClinicIds as allowedClinicIdsFor } from "@/lib/tenant-scope";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
export async function updateLeaveRequestStatusCommand(input: {
    leaveRequestId: string;
    session: AppSession;
    decisionNoteInput: string;
    status: string;
}) {
    const { leaveRequestId, session, decisionNoteInput, status } = input;
    if (!canPerformAction(session, "staff.manage")) {
        failCommand("staff-denied");
    }
    if (!leaveRequestId || (status !== "APPROVED" && status !== "REJECTED")) {
        failCommand("staff-leave-missing");
    }
    const nextStatus = status as "APPROVED" | "REJECTED";
    const request = await prisma.leaveRequest.findFirst({
        where: {
            id: leaveRequestId,
            organizationId: session.organizationId,
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
        },
    });
    if (!request) {
        failCommand("staff-leave-missing");
    }
    await prisma.$transaction(async (tx) => {
        await tx.leaveRequest.update({
            where: {
                id: request.id,
            },
            data: {
                status: nextStatus,
                decisionNote: decisionNoteInput || null,
            },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: nextStatus === "APPROVED" ? "leave_request.approved" : "leave_request.rejected",
                entityType: "LeaveRequest",
                entityId: request.id,
            },
        });
    });
}

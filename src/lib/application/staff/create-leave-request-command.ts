import "server-only";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { scopedStaffProfile, vietnamStartOfToday, } from "@/lib/application/staff/support";
export async function createLeaveRequestCommand(input: {
    session: AppSession;
    staffProfileId: string;
    startsAt: import("@/lib/form-validation").ParsedDate;
    leaveTypeInput: string;
    hoursInput: number | null;
    reasonInput: string;
    endsAt: Date | "invalid";
}) {
    const { session, staffProfileId, startsAt, leaveTypeInput, hoursInput, reasonInput, endsAt } = input;
    if (!canPerformAction(session, "staff.manage")) {
        failCommand("staff-denied");
    }
    if (!staffProfileId ||
        startsAt === "invalid" ||
        endsAt === "invalid" ||
        !startsAt ||
        !endsAt ||
        startsAt > endsAt) {
        failCommand("staff-leave-missing");
    }
    const profile = await scopedStaffProfile(session, staffProfileId);
    if (!profile) {
        failCommand("staff-profile-missing");
    }
    const shouldApproveImmediately = startsAt <= vietnamStartOfToday();
    const leave = await prisma.leaveRequest.create({
        data: {
            organizationId: session.organizationId,
            clinicId: profile.clinicId,
            staffProfileId: profile.id,
            leaveType: leaveTypeInput || "ANNUAL",
            status: shouldApproveImmediately ? "APPROVED" : "REQUESTED",
            startsAt,
            endsAt,
            hours: hoursInput,
            reason: reasonInput || null,
            decisionNote: shouldApproveImmediately
                ? "Quản lý tạo nghỉ khẩn cấp trong ngày nên hệ thống ghi nhận đã duyệt."
                : null,
        },
        select: {
            id: true,
        },
    });
    await prisma.auditLog.create({
        data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: shouldApproveImmediately
                ? "leave_request.created_approved_same_day"
                : "leave_request.created",
            entityType: "LeaveRequest",
            entityId: leave.id,
        },
    });
}

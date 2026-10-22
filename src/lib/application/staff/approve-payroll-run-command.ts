import "server-only";
import { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { scopedPayrollRun, } from "@/lib/application/staff/support";
export async function approvePayrollRunCommand(input: {
    session: AppSession;
    payrollRunId: string;
}) {
    const { session, payrollRunId } = input;
    if (!canPerformAction(session, "payroll.manage")) {
        failCommand("staff-denied");
    }
    const payrollRun = await scopedPayrollRun(session, payrollRunId);
    if (!payrollRun || payrollRun.status !== "DRAFT") {
        failCommand("staff-payroll-run-missing");
    }
    await prisma.$transaction(async (tx) => {
        await tx.payrollRun.update({
            where: {
                id: payrollRun.id,
            },
            data: {
                status: "APPROVED",
                approvedAt: new Date(),
            },
        });
        await tx.compensationAccrual.updateMany({
            where: {
                payrollRunId: payrollRun.id,
            },
            data: {
                status: "APPROVED",
            },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "payroll.run_approved",
                entityType: "PayrollRun",
                entityId: payrollRun.id,
                metadata: {
                    netAmount: Number(payrollRun.netAmount),
                } as Prisma.InputJsonValue,
            },
        });
    });
}

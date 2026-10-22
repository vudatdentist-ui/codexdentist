import "server-only";
import { Prisma } from "@prisma/client";
import { canPerformAction } from "@/lib/actions/permissions";
import { databaseActorId, } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { scopedPayrollRun, } from "@/lib/application/staff/support";
export async function voidPayrollRunCommand(input: {
    session: AppSession;
    payrollRunId: string;
}) {
    const { session, payrollRunId } = input;
    if (!canPerformAction(session, "payroll.manage")) {
        failCommand("staff-denied");
    }
    const payrollRun = await scopedPayrollRun(session, payrollRunId);
    if (!payrollRun || payrollRun.status === "PAID" || payrollRun.status === "VOID") {
        failCommand("staff-payroll-run-missing");
    }
    await prisma.$transaction(async (tx) => {
        const lineIds = payrollRun.lines.map((line) => line.id);
        if (lineIds.length > 0) {
            await tx.compensationAccrualLine.updateMany({
                where: {
                    payrollLineId: {
                        in: lineIds,
                    },
                },
                data: {
                    payrollLineId: null,
                },
            });
        }
        await tx.payrollLine.deleteMany({
            where: {
                payrollRunId: payrollRun.id,
            },
        });
        await tx.compensationAccrual.updateMany({
            where: {
                payrollRunId: payrollRun.id,
            },
            data: {
                payrollRunId: null,
                status: "EARNED",
            },
        });
        await tx.payrollRun.update({
            where: {
                id: payrollRun.id,
            },
            data: {
                status: "VOID",
            },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "payroll.run_voided",
                entityType: "PayrollRun",
                entityId: payrollRun.id,
                metadata: {
                    releasedLineCount: lineIds.length,
                } as Prisma.InputJsonValue,
            },
        });
    });
}

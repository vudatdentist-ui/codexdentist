import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, writeSettingsAuditLog, } from "@/lib/application/settings/support";
export async function updateSourceCommissionAccrualStatusCommand(input: {
    accrualId: string;
    session: AppSession;
    status: string;
}) {
    const { accrualId, session, status } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!accrualId || !["APPROVED", "PAID", "VOID"].includes(status)) {
        failCommand("settings-source-policy-missing");
    }
    const result = await prisma.sourceCommissionAccrual.updateMany({
        where: {
            id: accrualId,
            organizationId: session.organizationId,
            clinicId: {
                in: accessibleClinicIds(session),
            },
            ...(status === "APPROVED" ? { status: "EARNED" } : {}),
            ...(status === "PAID" ? { status: "APPROVED" } : {}),
        },
        data: {
            status,
            paidAt: status === "PAID" ? new Date() : null,
        },
    });
    if (result.count === 0) {
        failCommand("settings-source-policy-missing");
    }
    await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: status === "PAID"
            ? "source_commission_accrual.paid"
            : status === "VOID"
                ? "source_commission_accrual.voided"
                : "source_commission_accrual.approved",
        entityType: "SourceCommissionAccrual",
        entityId: accrualId,
        metadata: {
            status,
        },
    });
}

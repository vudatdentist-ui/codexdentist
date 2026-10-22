import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, writeSettingsAuditLog, } from "@/lib/application/settings/support";
export async function createSourceCommissionPolicyCommand(input: {
    session: AppSession;
    ratePercent: string | false | null;
    source: string;
    name: string;
    ownerLabel: string | null;
    fixedAmount: string | false;
    monthlyBudget: string | false | null;
    notes: string | null;
}) {
    const { session, ratePercent, source, name, ownerLabel, fixedAmount, monthlyBudget, notes } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    if (!source || !name || ratePercent === false || fixedAmount === false || monthlyBudget === false) {
        failCommand("settings-source-policy-missing");
    }
    const policy = await prisma.sourceCommissionPolicy.upsert({
        where: {
            organizationId_source: {
                organizationId: session.organizationId,
                source,
            },
        },
        update: {
            name,
            ownerLabel,
            ratePercent: ratePercent ?? "0",
            fixedAmount,
            monthlyBudget,
            notes,
            active: true,
        },
        create: {
            organizationId: session.organizationId,
            source,
            name,
            ownerLabel,
            ratePercent: ratePercent ?? "0",
            fixedAmount,
            monthlyBudget,
            notes,
        },
        select: {
            id: true,
        },
    });
    await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "source_commission_policy.upserted",
        entityType: "SourceCommissionPolicy",
        entityId: policy.id,
        metadata: {
            source,
            ratePercent: ratePercent ?? "0",
            fixedAmount,
            monthlyBudget,
        },
    });
}

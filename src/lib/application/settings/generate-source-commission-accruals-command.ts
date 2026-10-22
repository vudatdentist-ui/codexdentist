import "server-only";
import { databaseActorId } from "@/lib/form-validation";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { generateSourceCommissionAccruals } from "@/lib/source-commission";
import { failCommand } from "@/lib/application/command-failure";
import { canWriteSettings, } from "@/lib/application/settings/support";
export async function generateSourceCommissionAccrualsCommand(input: {
    session: AppSession;
}) {
    const { session } = input;
    if (!canWriteSettings(session)) {
        failCommand("settings-denied");
    }
    await generateSourceCommissionAccruals({
        organizationId: session.organizationId,
        clinicIds: accessibleClinicIds(session),
        actorId: databaseActorId(session.userId),
    });
}

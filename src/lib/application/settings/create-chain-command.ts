import "server-only";
import { randomBytes } from "crypto";
import { hashPassword } from "@/lib/auth";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { failCommand } from "@/lib/application/command-failure";
import { roleAssignmentData, createPasswordSetupArtifactsTx, PasswordSetupArtifacts, canManageClinics, findChainOwnerCandidate, canAssignStaffRoles, } from "@/lib/application/settings/support";
export async function createChainCommand(input: {
    ownerMode: string;
    ownerFullName: string | null;
    ownerEmail: string | null;
    session: AppSession;
    name: string;
    legalName: string | null;
    brandName: string | null;
    taxCode: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    specialty: string;
    ownerUserId: string | null;
}) {
    const { ownerMode, ownerFullName, ownerEmail, session, name, legalName, brandName, taxCode, phone, email, website, specialty, ownerUserId } = input;
    if (!canManageClinics(session)) {
        failCommand("settings-denied");
    }
    if (!name) {
        failCommand("settings-chain-missing");
    }
    let existingOwnerId: string | null = null;
    if (ownerMode === "existing" && ownerUserId) {
        const owner = await findChainOwnerCandidate(session, ownerUserId);
        if (!owner) {
            failCommand("settings-chain-owner-missing");
        }
        existingOwnerId = owner.id;
    }
    if (ownerMode === "new") {
        if (!canAssignStaffRoles(session, ["AREA_MANAGER"])) {
            failCommand("settings-denied");
        }
        if (!ownerFullName || !ownerEmail) {
            failCommand("settings-chain-owner-missing");
        }
        const existingOwner = await prisma.user.findUnique({
            where: { email: ownerEmail },
            select: { id: true },
        });
        if (existingOwner) {
            failCommand("settings-email-exists");
        }
    }
    let setup: PasswordSetupArtifacts | null = null;
    setup = await prisma.$transaction(async (tx) => {
        let ownerId = existingOwnerId;
        let ownerSetup: PasswordSetupArtifacts | null = null;
        if (ownerMode === "new" && ownerFullName && ownerEmail) {
            const owner = await tx.user.create({
                data: {
                    organizationId: session.organizationId,
                    email: ownerEmail,
                    fullName: ownerFullName,
                    passwordHash: hashPassword(randomBytes(32).toString("base64url")),
                    role: "AREA_MANAGER",
                    active: true,
                    mustChangePassword: true,
                },
                select: { id: true },
            });
            await tx.userRoleAssignment.create({
                data: roleAssignmentData(session.organizationId, owner.id, "AREA_MANAGER", null),
            });
            ownerSetup = await createPasswordSetupArtifactsTx(tx, {
                organizationId: session.organizationId,
                organizationDomain: session.organizationDomain,
                organizationSlug: session.organizationSlug,
                userId: owner.id,
                createdById: databaseActorId(session.userId),
                email: ownerEmail,
                fullName: ownerFullName,
                clinicId: session.activeClinicId ?? accessibleClinicIds(session)[0] ?? null,
            });
            ownerId = owner.id;
        }
        const chain = await tx.chain.create({
            data: {
                organizationId: session.organizationId,
                ownerId,
                name,
                legalName,
                brandName,
                taxCode,
                phone,
                email,
                website,
                specialty,
            },
            select: { id: true },
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "chain.created",
                entityType: "Chain",
                entityId: chain.id,
                metadata: {
                    name,
                    specialty,
                    ownerId,
                },
            },
        });
        return ownerSetup;
    });
    return { setup };
}

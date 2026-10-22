import "server-only";
import { randomBytes } from "crypto";
import { hashPassword } from "@/lib/auth";
import { databaseActorId } from "@/lib/form-validation";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { isSuperAdminSession } from "@/lib/super-admin";
import { bootstrapOrganizationDefaults } from "@/lib/tenant-bootstrap";
import { isValidTenantSlug, tenantDomainForSlug, } from "@/lib/tenant";
import { failCommand } from "@/lib/application/command-failure";
import { roleAssignmentData, createPasswordSetupArtifactsTx, PasswordSetupArtifacts, } from "@/lib/application/settings/support";
export async function createOrganizationCommand(input: {
    ownerEmail: string;
    name: string;
    ownerFullName: string;
    session: AppSession;
    slug: string;
}) {
    const { ownerEmail, name, ownerFullName, session, slug } = input;
    if (!isSuperAdminSession(session)) {
        failCommand("settings-denied");
    }
    if (!name || !ownerFullName || !ownerEmail || !isValidTenantSlug(slug)) {
        failCommand("settings-organization-missing");
    }
    const domain = tenantDomainForSlug(slug);
    let result: {
        organization: {
            id: string;
            name: string;
            slug: string | null;
            primaryDomain: string | null;
        };
        owner: {
            id: string;
            email: string;
            fullName: string;
        };
        setup: PasswordSetupArtifacts;
    } | null = null;
    const existingOwner = await prisma.user.findUnique({
        where: { email: ownerEmail },
        select: { id: true },
    });
    if (existingOwner) {
        failCommand("settings-email-exists");
    }
    result = await prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
            data: {
                name,
                legalName: name,
                slug,
                primaryDomain: domain,
                locale: "vi-VN",
            },
            select: {
                id: true,
                name: true,
                slug: true,
                primaryDomain: true,
            },
        });
        const owner = await tx.user.create({
            data: {
                organizationId: organization.id,
                email: ownerEmail,
                fullName: ownerFullName,
                passwordHash: hashPassword(randomBytes(32).toString("base64url")),
                role: "OWNER",
                active: true,
                mustChangePassword: true,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
            },
        });
        await tx.userRoleAssignment.create({
            data: roleAssignmentData(organization.id, owner.id, "OWNER", null),
        });
        const setup = await createPasswordSetupArtifactsTx(tx, {
            organizationId: organization.id,
            organizationDomain: organization.primaryDomain,
            organizationSlug: organization.slug,
            userId: owner.id,
            createdById: null,
            email: owner.email,
            fullName: owner.fullName,
        });
        await tx.auditLog.create({
            data: {
                organizationId: session.organizationId,
                actorId: databaseActorId(session.userId),
                action: "organization.created",
                entityType: "Organization",
                entityId: organization.id,
                metadata: {
                    domain,
                    ownerEmail,
                    slug,
                },
            },
        });
        await bootstrapOrganizationDefaults({
            organizationId: organization.id,
            organizationName: organization.name,
            organizationSlug: organization.slug,
            organizationDomain: organization.primaryDomain,
            ownerUserId: owner.id,
            ownerEmail: owner.email,
            ownerFullName: owner.fullName,
        }, tx);
        return { organization, owner, setup };
    }, { timeout: 60000, maxWait: 10000 });
    return { result };
}

"use server";

import type { Prisma } from "@prisma/client";
import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { canPerformAction } from "@/lib/actions/permissions";
import { hashPassword, requireViewSession } from "@/lib/auth";
import { databaseActorId, requiredString } from "@/lib/form-validation";
import { renderNotificationTemplate } from "@/lib/notification-templates";
import { processNotificationNow } from "@/lib/notifications";
import { createPasswordSetupToken } from "@/lib/password-reset";
import {
  isUploadedPatientFile,
  storeStaffProfileUpload,
} from "@/lib/patient-file-storage";
import { canUseAllClinics, effectiveRoles, type AppRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { generateSourceCommissionAccruals } from "@/lib/source-commission";
import { isSuperAdminSession } from "@/lib/super-admin";
import { bootstrapOrganizationDefaults } from "@/lib/tenant-bootstrap";
import {
  isValidTenantSlug,
  normalizeTenantSlug,
  tenantDomainForSlug,
} from "@/lib/tenant";

const userRoles = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
  "PATIENT",
] as const;
const staffProfileRoles = userRoles.filter((role) => role !== "PATIENT");
const organizationScopedRoles = ["OWNER", "AREA_MANAGER"] as const;
const staffRolePriority = [
  "OWNER",
  "AREA_MANAGER",
  "CLINIC_MANAGER",
  "DENTIST",
  "HYGIENIST",
  "FRONT_DESK",
  "BILLING",
] as const;

export async function createOrganizationAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!isSuperAdminSession(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const name = requiredString(formData.get("name"));
  const slug = normalizeTenantSlug(requiredString(formData.get("slug")));
  const ownerFullName = requiredString(formData.get("ownerFullName"));
  const ownerEmail = requiredString(formData.get("ownerEmail")).toLowerCase();

  if (!name || !ownerFullName || !ownerEmail || !isValidTenantSlug(slug)) {
    redirect("/settings?notice=settings-organization-missing");
  }

  try {
    const existingOwner = await prisma.user.findUnique({
      where: {
        email: ownerEmail,
      },
      select: {
        id: true,
      },
    });

    if (existingOwner) {
      redirect("/settings?notice=settings-email-exists");
    }

    const domain = tenantDomainForSlug(slug);
    const result = await prisma.$transaction(async (tx) => {
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

      return { organization, owner };
    });
    await bootstrapOrganizationDefaults({
      organizationId: result.organization.id,
      organizationName: result.organization.name,
      organizationSlug: result.organization.slug,
      organizationDomain: result.organization.primaryDomain,
      ownerUserId: result.owner.id,
      ownerEmail: result.owner.email,
      ownerFullName: result.owner.fullName,
    });
    const setup = await createPasswordSetupToken({
      organizationId: result.organization.id,
      userId: result.owner.id,
      createdById: null,
    });
    const setupNotification = await createPasswordSetupNotification({
      organizationId: result.organization.id,
      clinicId: null,
      userId: result.owner.id,
      email: ownerEmail,
      fullName: ownerFullName,
      setupUrl: setup.url,
      expiresAt: setup.expiresAt,
    });
    await processNotificationNow(setupNotification.id, setupNotification.deliveryContent);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-organization-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect(`/settings?notice=settings-organization-created&domain=${encodeURIComponent(tenantDomainForSlug(slug))}`);
}

export async function createStaffAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const fullName = requiredString(formData.get("fullName"));
  const email = requiredString(formData.get("email")).toLowerCase();
  const title = optionalString(formData.get("title"));
  const clinicId = requiredString(formData.get("clinicId"));
  const createAssignmentRoles = Array.from(
    new Set(
      formData
        .getAll("assignmentRole")
        .map((value) => requiredString(value))
        .filter(isStaffProfileRole),
    ),
  );

  if (!canAssignStaffRoles(session, createAssignmentRoles)) {
    redirect("/settings?notice=settings-denied");
  }

  if (
    !fullName ||
    !email ||
    createAssignmentRoles.length === 0 ||
    (!canUseAllClinics(session) && !session.clinicIds.includes(clinicId))
  ) {
    redirect("/settings?notice=settings-missing");
  }

  const role = primaryStaffRoleForAssignments(createAssignmentRoles);

  if (
    !canUseAllClinics(session) &&
    createAssignmentRoles.some(isOrganizationScopedRole)
  ) {
    redirect("/settings?notice=settings-denied");
  }

  const scopedClinic = await findActiveScopedClinic(session, clinicId);

  if (!scopedClinic) {
    redirect("/settings?notice=settings-clinic-inactive");
  }

  const targetOrganizationId = scopedClinic.organizationId;

  if (targetOrganizationId !== session.organizationId && !isSuperAdminSession(session)) {
    redirect("/settings?notice=settings-denied");
  }

  let notice: string | null = null;

  try {
    const existing = await prisma.user.findUnique({
      where: {
        email,
      },
      select: {
        id: true,
      },
    });

    if (existing) {
      notice = "settings-email-exists";
    } else {
      const user = await prisma.user.create({
        data: {
          organizationId: targetOrganizationId,
          email,
          fullName,
          passwordHash: hashPassword(randomBytes(32).toString("base64url")),
          role,
          active: true,
          mustChangePassword: true,
          clinics: {
            create: {
              clinicId,
            },
          },
        },
        select: {
          id: true,
        },
      });
      await prisma.userRoleAssignment.createMany({
        data: createAssignmentRoles.map((assignmentRole) =>
          roleAssignmentData(targetOrganizationId, user.id, assignmentRole, clinicId),
        ),
        skipDuplicates: true,
      });
      await prisma.staffProfile.create({
        data: {
          organizationId: targetOrganizationId,
          userId: user.id,
          clinicId,
          employeeCode: defaultEmployeeCode(user.id),
          title: title ?? defaultRoleTitle(role),
          department: "Clinic operations",
          active: true,
        },
      });
      const setup = await createPasswordSetupToken({
        organizationId: targetOrganizationId,
        userId: user.id,
        createdById: databaseActorId(session.userId),
      });
      const setupNotification = await createPasswordSetupNotification({
        organizationId: targetOrganizationId,
        clinicId,
        userId: user.id,
        email,
        fullName,
        setupUrl: setup.url,
        expiresAt: setup.expiresAt,
      });
      await processNotificationNow(setupNotification.id, setupNotification.deliveryContent);

      await writeSettingsAuditLog({
        organizationId: targetOrganizationId,
        actorId: databaseActorId(session.userId),
        action: "staff.created",
        entityId: user.id,
        metadata: {
          email,
          derivedRole: role,
          assignmentRoles: createAssignmentRoles,
          clinicId,
          createdFromOrganizationId: session.organizationId,
        },
      });

      revalidatePath("/settings");
      redirect(
        `/settings?notice=settings-staff-created&setupEmail=${encodeURIComponent(
          email,
        )}`,
      );
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    notice = "settings-database";
  }

  if (notice) {
    redirect(`/settings?notice=${notice}`);
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-staff-created");
}

export async function createStaffPasswordSetupLinkAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const userId = requiredString(formData.get("userId"));

  if (!userId) {
    redirect("/settings?notice=settings-user-not-found");
  }

  if (userId === session.userId) {
    redirect("/settings?notice=settings-self-password-link");
  }

  let notice: string | null = null;
  let setupEmail = "";

  try {
    const user = await findScopedUser(session, userId);

    if (!user) {
      notice = "settings-user-not-found";
    } else {
      assertCanManageStaffTarget(session, user);
      const setup = await createPasswordSetupToken({
        organizationId: session.organizationId,
        userId: user.id,
        createdById: databaseActorId(session.userId),
      });
      setupEmail = user.email;
      const setupNotification = await createPasswordSetupNotification({
        organizationId: session.organizationId,
        clinicId: user.clinics[0]?.clinicId ?? session.activeClinicId ?? session.clinicIds[0] ?? null,
        userId: user.id,
        email: user.email,
        fullName: user.fullName,
        setupUrl: setup.url,
        expiresAt: setup.expiresAt,
      });
      await processNotificationNow(setupNotification.id, setupNotification.deliveryContent);

      await prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          mustChangePassword: true,
        },
      });

      await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "staff.password_setup_link_created",
        entityId: user.id,
      });
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    notice = "settings-database";
  }

  if (notice) {
    redirect(`/settings?notice=${notice}`);
  }

  revalidatePath("/settings");
  redirect(
    `/settings?notice=settings-password-link-created&setupEmail=${encodeURIComponent(
      setupEmail,
    )}`,
  );
}

export async function createClinicAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const name = requiredString(formData.get("name"));
  const organizationIdInput = optionalString(formData.get("organizationId"));
  const city = requiredString(formData.get("city"));
  const address = requiredString(formData.get("address"));
  const phone = requiredString(formData.get("phone"));

  if (!name || !city || !address) {
    redirect("/settings?notice=settings-clinic-missing");
  }

  try {
    const targetOrganizationId = await targetClinicOrganizationId(session, organizationIdInput);

    const clinic = await prisma.clinic.create({
      data: {
        organizationId: targetOrganizationId,
        chainId: null,
        name,
        city,
        address,
        phone: phone || null,
        ...(targetOrganizationId === session.organizationId
          ? {
              users: {
                create: {
                  userId: databaseActorId(session.userId) ?? session.userId,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
      },
    });

    await writeSettingsAuditLog({
      organizationId: targetOrganizationId,
      actorId: databaseActorId(session.userId),
      action: "clinic.created",
      entityId: clinic.id,
      metadata: {
        name,
        city,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-clinic-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-clinic-created");
}

export async function updateClinicAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const clinicId = requiredString(formData.get("clinicId"));
  const name = requiredString(formData.get("name"));
  const city = requiredString(formData.get("city"));
  const address = requiredString(formData.get("address"));
  const phone = requiredString(formData.get("phone"));

  if (!clinicId || !name || !city || !address) {
    redirect("/settings?notice=settings-clinic-missing");
  }

  const scopedClinic = await findScopedClinic(session, clinicId);

  if (!scopedClinic) {
    redirect("/settings?notice=settings-clinic-not-found");
  }

  try {
    const targetOrganizationId = scopedClinic.organizationId;

    await prisma.clinic.update({
      where: {
        id: clinicId,
      },
      data: {
        organizationId: targetOrganizationId,
        chainId: null,
        name,
        city,
        address,
        phone: phone || null,
      },
    });

    await writeSettingsAuditLog({
      organizationId: targetOrganizationId,
      actorId: databaseActorId(session.userId),
      action: "clinic.updated",
      entityId: clinicId,
      metadata: {
        name,
        city,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-clinic-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-clinic-updated");
}

export async function createChairAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const clinicId = requiredString(formData.get("clinicId"));
  const name = requiredString(formData.get("name"));
  const specialty = optionalString(formData.get("specialty"));

  if (!clinicId || !name) {
    redirect("/settings?notice=settings-chair-missing");
  }

  const scopedClinic = await findScopedClinic(session, clinicId);

  if (!scopedClinic) {
    redirect("/settings?notice=settings-clinic-not-found");
  }

  try {
    const chair = await prisma.chair.create({
      data: {
        clinicId,
        name,
        specialty,
        active: true,
        operationalStatus: "READY",
      },
      select: {
        id: true,
      },
    });

    await writeSettingsAuditLog({
      organizationId: scopedClinic.organizationId,
      actorId: databaseActorId(session.userId),
      action: "chair.created",
      entityType: "Chair",
      entityId: chair.id,
      metadata: {
        clinicId,
        name,
        specialty,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-chair-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/schedule");
  redirect("/settings?notice=settings-chair-created");
}

export async function updateChairAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const chairId = requiredString(formData.get("chairId"));
  const clinicId = requiredString(formData.get("clinicId"));
  const name = requiredString(formData.get("name"));
  const specialty = optionalString(formData.get("specialty"));

  if (!chairId || !clinicId || !name) {
    redirect("/settings?notice=settings-chair-missing");
  }

  const scopedChair = await findScopedChair(session, chairId, clinicId);

  if (!scopedChair) {
    redirect("/settings?notice=settings-chair-not-found");
  }

  try {
    await prisma.chair.update({
      where: {
        id: chairId,
      },
      data: {
        name,
        specialty,
      },
    });

    await writeSettingsAuditLog({
      organizationId: scopedChair.clinic.organizationId,
      actorId: databaseActorId(session.userId),
      action: "chair.updated",
      entityType: "Chair",
      entityId: chairId,
      metadata: {
        clinicId,
        name,
        specialty,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-chair-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/schedule");
  redirect("/settings?notice=settings-chair-updated");
}

export async function toggleChairStatusAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const chairId = requiredString(formData.get("chairId"));
  const clinicId = requiredString(formData.get("clinicId"));
  const active = requiredString(formData.get("active")) === "true";

  if (!chairId || !clinicId) {
    redirect("/settings?notice=settings-chair-not-found");
  }

  const scopedChair = await findScopedChair(session, chairId, clinicId);

  if (!scopedChair) {
    redirect("/settings?notice=settings-chair-not-found");
  }

  try {
    await prisma.$transaction([
      prisma.chair.update({
        where: {
          id: chairId,
        },
        data: {
          active,
          operationalStatus: active ? "READY" : "READY",
          operationalStatusUpdatedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: scopedChair.clinic.organizationId,
          actorId: databaseActorId(session.userId),
          action: active ? "chair.activated" : "chair.deactivated",
          entityType: "Chair",
          entityId: chairId,
          metadata: {
            clinicId,
          },
        },
      }),
    ]);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/schedule");
  redirect(active ? "/settings?notice=settings-chair-activated" : "/settings?notice=settings-chair-deactivated");
}

export async function createChainAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const name = requiredString(formData.get("name"));
  const legalName = optionalString(formData.get("legalName"));
  const brandName = optionalString(formData.get("brandName"));
  const taxCode = optionalString(formData.get("taxCode"));
  const phone = optionalString(formData.get("phone"));
  const email = optionalString(formData.get("email"));
  const website = optionalString(formData.get("website"));
  const specialty = optionalString(formData.get("specialty")) ?? "DENTAL";
  const ownerMode = optionalString(formData.get("ownerMode")) ?? "none";
  const ownerUserId = optionalString(formData.get("ownerUserId"));
  const ownerFullName = optionalString(formData.get("ownerFullName"));
  const ownerEmail = optionalString(formData.get("ownerEmail"))?.toLowerCase() ?? null;

  if (!name) {
    redirect("/settings?notice=settings-chain-missing");
  }

  try {
    let ownerId: string | null = null;
    let setupEmail: string | null = null;

    if (ownerMode === "existing" && ownerUserId) {
      const owner = await findChainOwnerCandidate(session, ownerUserId);

      if (!owner) {
        redirect("/settings?notice=settings-chain-owner-missing");
      }

      ownerId = owner.id;
    }

    if (ownerMode === "new") {
      if (!canAssignStaffRoles(session, ["AREA_MANAGER"])) {
        redirect("/settings?notice=settings-denied");
      }

      if (!ownerFullName || !ownerEmail) {
        redirect("/settings?notice=settings-chain-owner-missing");
      }

      const existingOwner = await prisma.user.findUnique({
        where: {
          email: ownerEmail,
        },
        select: {
          id: true,
        },
      });

      if (existingOwner) {
        redirect("/settings?notice=settings-email-exists");
      }

      const owner = await prisma.user.create({
        data: {
          organizationId: session.organizationId,
          email: ownerEmail,
          fullName: ownerFullName,
          passwordHash: hashPassword(randomBytes(32).toString("base64url")),
          role: "AREA_MANAGER",
          active: true,
          mustChangePassword: true,
        },
        select: {
          id: true,
        },
      });
      await prisma.userRoleAssignment.create({
        data: roleAssignmentData(session.organizationId, owner.id, "AREA_MANAGER", null),
      });
      const setup = await createPasswordSetupToken({
        organizationId: session.organizationId,
        userId: owner.id,
        createdById: databaseActorId(session.userId),
      });
      const setupNotification = await createPasswordSetupNotification({
        organizationId: session.organizationId,
        clinicId: session.activeClinicId ?? session.clinicIds[0] ?? null,
        userId: owner.id,
        email: ownerEmail,
        fullName: ownerFullName,
        setupUrl: setup.url,
        expiresAt: setup.expiresAt,
      });
      await processNotificationNow(setupNotification.id, setupNotification.deliveryContent);

      ownerId = owner.id;
      setupEmail = ownerEmail;
    }

    const chain = await prisma.chain.create({
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
      select: {
        id: true,
      },
    });

    await writeSettingsAuditLog({
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
    });

    if (setupEmail) {
      revalidatePath("/settings");
      redirect(
        `/settings?notice=settings-chain-created&setupEmail=${encodeURIComponent(
          setupEmail,
        )}`,
      );
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-chain-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-chain-created");
}

export async function updateChainAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const chainId = requiredString(formData.get("chainId"));
  const name = requiredString(formData.get("name"));
  const legalName = optionalString(formData.get("legalName"));
  const brandName = optionalString(formData.get("brandName"));
  const taxCode = optionalString(formData.get("taxCode"));
  const phone = optionalString(formData.get("phone"));
  const email = optionalString(formData.get("email"));
  const website = optionalString(formData.get("website"));
  const specialty = optionalString(formData.get("specialty")) ?? "DENTAL";
  const ownerIdInput = optionalString(formData.get("ownerId"));

  if (!chainId || !name) {
    redirect("/settings?notice=settings-chain-missing");
  }

  const scopedChain = await findScopedChain(session, chainId);

  if (!scopedChain) {
    redirect("/settings?notice=settings-chain-not-found");
  }

  try {
    const owner = ownerIdInput ? await findChainOwnerCandidate(session, ownerIdInput) : null;

    if (ownerIdInput && !owner) {
      redirect("/settings?notice=settings-chain-owner-missing");
    }

    await prisma.chain.update({
      where: {
        id: chainId,
      },
      data: {
        ownerId: owner?.id ?? null,
        name,
        legalName,
        brandName,
        taxCode,
        phone,
        email,
        website,
        specialty,
      },
    });

    await writeSettingsAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "chain.updated",
      entityType: "Chain",
      entityId: chainId,
      metadata: {
        name,
        specialty,
        ownerId: owner?.id ?? null,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-chain-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-chain-updated");
}

export async function toggleChainStatusAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const chainId = requiredString(formData.get("chainId"));
  const active = requiredString(formData.get("active")) === "true";

  if (!chainId) {
    redirect("/settings?notice=settings-chain-not-found");
  }

  const scopedChain = await findScopedChain(session, chainId);

  if (!scopedChain) {
    redirect("/settings?notice=settings-chain-not-found");
  }

  try {
    await prisma.$transaction([
      prisma.chain.update({
        where: {
          id: chainId,
        },
        data: {
          active,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: active ? "chain.activated" : "chain.deactivated",
          entityType: "Chain",
          entityId: chainId,
        },
      }),
    ]);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect(active ? "/settings?notice=settings-chain-activated" : "/settings?notice=settings-chain-deactivated");
}

export async function toggleClinicStatusAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canManageClinics(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const clinicId = requiredString(formData.get("clinicId"));
  const active = requiredString(formData.get("active")) === "true";

  if (!clinicId) {
    redirect("/settings?notice=settings-clinic-not-found");
  }

  const scopedClinic = await findScopedClinic(session, clinicId);

  if (!scopedClinic) {
    redirect("/settings?notice=settings-clinic-not-found");
  }

  try {
    await prisma.$transaction([
      prisma.clinic.update({
        where: {
          id: clinicId,
        },
        data: {
          active,
        },
      }),
      prisma.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: active ? "clinic.activated" : "clinic.deactivated",
          entityType: "Clinic",
          entityId: clinicId,
        },
      }),
    ]);
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  redirect(active ? "/settings?notice=settings-clinic-activated" : "/settings?notice=settings-clinic-deactivated");
}

export async function updateStaffRoleAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const userId = requiredString(formData.get("userId"));
  const assignmentClinicId = optionalString(formData.get("assignmentClinicId"));
  const assignmentRoles = Array.from(
    new Set(
      formData
        .getAll("assignmentRole")
        .map((value) => requiredString(value))
        .filter(isStaffProfileRole),
    ),
  );

  if (!userId || assignmentRoles.length === 0) {
    redirect("/settings?notice=settings-missing");
  }

  const role = primaryStaffRoleForAssignments(assignmentRoles);

  if (!canAssignStaffRoles(session, assignmentRoles)) {
    redirect("/settings?notice=settings-denied");
  }

  if (
    !canUseAllClinics(session) &&
    assignmentRoles.some(isOrganizationScopedRole)
  ) {
    redirect("/settings?notice=settings-denied");
  }

  let notice: string | null = null;

  try {
    const user = await findScopedUser(session, userId);

    if (!user) {
      notice = "settings-user-not-found";
    } else {
      assertCanManageStaffTarget(session, user);
      if (staffUserHasRole(user, "OWNER") && !assignmentRoles.includes("OWNER")) {
        await assertAnotherActiveOwner(user.organizationId, user.id);
      }
      const clinicScopedRoles = assignmentRoles.filter(
        (assignmentRole) => !isOrganizationScopedRole(assignmentRole),
      );
      const clinicId =
        assignmentClinicId ??
        user.clinics[0]?.clinicId ??
        session.activeClinicId ??
        session.clinicIds[0] ??
        null;

      if (clinicScopedRoles.length > 0) {
        if (!clinicId) {
          redirect("/settings?notice=settings-missing");
        }

        const scopedClinic = await findActiveScopedClinic(session, clinicId);

        if (!scopedClinic || scopedClinic.organizationId !== user.organizationId) {
          redirect("/settings?notice=settings-user-not-found");
        }
      }

      const assignments = assignmentRoles.map((assignmentRole) =>
        roleAssignmentData(
          user.organizationId,
          userId,
          assignmentRole,
          isOrganizationScopedRole(assignmentRole) ? null : clinicId,
        ),
      );
      const membershipClinicIds =
        clinicScopedRoles.length > 0 && clinicId ? [clinicId] : [];
      const userClinicDeleteWhere = canUseAllClinics(session)
        ? { userId }
        : {
            userId,
            clinicId: {
              in: session.clinicIds,
            },
          };

      await prisma.$transaction([
        prisma.user.update({
          where: {
            id: userId,
          },
          data: {
            role,
          },
        }),
        prisma.userRoleAssignment.deleteMany({
          where: {
            userId,
            organizationId: user.organizationId,
          },
        }),
        prisma.userRoleAssignment.createMany({
          data: assignments,
          skipDuplicates: true,
        }),
        prisma.userClinic.deleteMany({
          where: userClinicDeleteWhere,
        }),
        ...(membershipClinicIds.length > 0
          ? [
              prisma.userClinic.createMany({
                data: membershipClinicIds.map((membershipClinicId) => ({
                  userId,
                  clinicId: membershipClinicId,
                })),
                skipDuplicates: true,
              }),
            ]
          : []),
        ...(clinicScopedRoles.length > 0 && clinicId
          ? [
              prisma.staffProfile.updateMany({
                where: {
                  userId,
                  organizationId: user.organizationId,
                },
                data: {
                  clinicId,
                },
              }),
            ]
          : []),
      ]);

      await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "staff.role_updated",
        entityId: userId,
        metadata: {
          derivedRole: role,
          assignmentRoles,
          assignmentClinicId: clinicId,
        },
      });
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    notice = "settings-database";
  }

  if (notice) {
    redirect(`/settings?notice=${notice}`);
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-role-updated");
}

export async function updateStaffProfileAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const userId = requiredString(formData.get("userId"));
  const fullName = requiredString(formData.get("fullName"));
  const phone = optionalString(formData.get("phone"));
  const employeeCodeInput = optionalString(formData.get("employeeCode"));
  const title = optionalString(formData.get("title"));
  const department = optionalString(formData.get("department"));
  const contractType = optionalString(formData.get("contractType")) ?? "FULL_TIME";
  const clinicId = optionalString(formData.get("clinicId"));
  const hireDate = optionalDate(formData.get("hireDate"));
  const dateOfBirth = optionalDate(formData.get("dateOfBirth"));
  const gender = optionalString(formData.get("gender"));
  const baseSalary = optionalDecimal(formData.get("baseSalary"));
  const commissionRate = optionalDecimal(formData.get("commissionRate"));
  const avatarFile = formData.get("avatar");

  if (!userId || !fullName) {
    redirect("/settings?notice=settings-profile-missing-fields");
  }

  if (clinicId && !canUseAllClinics(session) && !session.clinicIds.includes(clinicId)) {
    redirect("/settings?notice=settings-user-not-found");
  }

  if (clinicId) {
    const scopedClinic = await findActiveScopedClinic(session, clinicId);

    if (!scopedClinic) {
      redirect("/settings?notice=settings-clinic-inactive");
    }
  }

  if (hireDate === false || dateOfBirth === false) {
    redirect("/settings?notice=settings-profile-bad-date");
  }

  if (baseSalary === false || commissionRate === false) {
    redirect("/settings?notice=settings-profile-bad-number");
  }

  if (isUploadedPatientFile(avatarFile)) {
    if (!avatarFile.type.startsWith("image/") || avatarFile.type === "image/svg+xml") {
      redirect("/settings?notice=settings-profile-bad-avatar");
    }

    if (avatarFile.size > 5 * 1024 * 1024) {
      redirect("/settings?notice=settings-profile-avatar-large");
    }
  }

  let notice: string | null = null;

  try {
    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: session.organizationId,
        clinics: {
          some: {
            clinicId: {
              in: session.clinicIds,
            },
          },
        },
      },
      select: {
        id: true,
        staffProfile: {
          select: {
            employeeCode: true,
          },
        },
      },
    });

    if (!user) {
      notice = "settings-user-not-found";
    } else {
      const employeeCode =
        employeeCodeInput || user.staffProfile?.employeeCode || defaultEmployeeCode(user.id);
      const storedAvatar = isUploadedPatientFile(avatarFile)
        ? await storeStaffProfileUpload({
            file: avatarFile,
            organizationId: session.organizationId,
            userId: user.id,
          })
        : null;
      const profileData = {
        clinicId: clinicId || null,
        employeeCode,
        title,
        department,
        contractType,
        baseSalary: baseSalary || null,
        commissionRate: commissionRate || null,
        hireDate: hireDate || null,
        dateOfBirth: dateOfBirth || null,
        gender,
        ...(storedAvatar
          ? {
              avatarFileName: storedAvatar.fileName,
              avatarMimeType: storedAvatar.mimeType,
              avatarSizeBytes: storedAvatar.sizeBytes,
              avatarStorageProvider: storedAvatar.storageProvider,
              avatarStorageKey: storedAvatar.storageKey,
              avatarThumbnailMimeType: storedAvatar.thumbnail?.mimeType ?? null,
              avatarThumbnailStorageKey: storedAvatar.thumbnail?.storageKey ?? null,
            }
          : {}),
      };

      await prisma.$transaction([
        prisma.user.update({
          where: {
            id: user.id,
          },
          data: {
            fullName,
            phone,
          },
        }),
        prisma.staffProfile.upsert({
          where: {
            userId: user.id,
          },
          create: {
            organizationId: session.organizationId,
            userId: user.id,
            ...profileData,
          },
          update: profileData,
        }),
        prisma.auditLog.create({
          data: {
            organizationId: session.organizationId,
            actorId: databaseActorId(session.userId),
            action: "staff.profile_updated",
            entityType: "User",
            entityId: user.id,
            metadata: {
              employeeCode,
              avatarUploaded: Boolean(storedAvatar),
            } as Prisma.InputJsonValue,
          },
        }),
      ]);
    }
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      notice = "settings-profile-code-exists";
    } else {
      notice = "settings-database";
    }
  }

  if (notice) {
    redirect(`/settings?notice=${notice}`);
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-profile-updated");
}

export async function createSourceCommissionPolicyAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const source = requiredString(formData.get("source")).toUpperCase();
  const name = requiredString(formData.get("name"));
  const ownerLabel = optionalString(formData.get("ownerLabel"));
  const ratePercent = optionalDecimal(formData.get("ratePercent"));
  const fixedAmount = optionalDecimal(formData.get("fixedAmount")) ?? "0";
  const monthlyBudget = optionalDecimal(formData.get("monthlyBudget"));
  const notes = optionalString(formData.get("notes"));

  if (!source || !name || ratePercent === false || fixedAmount === false || monthlyBudget === false) {
    redirect("/settings?notice=settings-source-policy-missing");
  }

  try {
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
  } catch {
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/reports");
  redirect("/settings?notice=settings-source-policy-saved");
}

export async function toggleSourceCommissionPolicyAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const policyId = requiredString(formData.get("policyId"));
  const active = requiredString(formData.get("active")) === "true";

  if (!policyId) {
    redirect("/settings?notice=settings-source-policy-missing");
  }

  try {
    await prisma.sourceCommissionPolicy.updateMany({
      where: {
        id: policyId,
        organizationId: session.organizationId,
      },
      data: {
        active,
      },
    });

    await writeSettingsAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: active ? "source_commission_policy.activated" : "source_commission_policy.deactivated",
      entityType: "SourceCommissionPolicy",
      entityId: policyId,
    });
  } catch {
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/reports");
  redirect("/settings?notice=settings-source-policy-saved");
}

export async function generateSourceCommissionAccrualsAction() {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  try {
    await generateSourceCommissionAccruals({
      organizationId: session.organizationId,
      clinicIds: session.clinicIds,
      actorId: databaseActorId(session.userId),
    });
  } catch {
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/reports");
  redirect("/settings?notice=settings-source-accruals-generated");
}

export async function updateSourceCommissionAccrualStatusAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const accrualId = requiredString(formData.get("accrualId"));
  const status = requiredString(formData.get("status"));

  if (!accrualId || !["APPROVED", "PAID", "VOID"].includes(status)) {
    redirect("/settings?notice=settings-source-policy-missing");
  }

  try {
    const result = await prisma.sourceCommissionAccrual.updateMany({
      where: {
        id: accrualId,
        organizationId: session.organizationId,
        clinicId: {
          in: session.clinicIds,
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
      redirect("/settings?notice=settings-source-policy-missing");
    }

    await writeSettingsAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action:
        status === "PAID"
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
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/settings?notice=settings-database");
  }

  revalidatePath("/settings");
  revalidatePath("/reports");
  redirect("/settings?notice=settings-source-policy-saved");
}

export async function sendNotificationTestAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const channel = requiredString(formData.get("channel")).toUpperCase();
  const recipient = requiredString(formData.get("recipient"));
  const subject =
    requiredString(formData.get("subject")) || "Codexdentist notification test";
  const body =
    requiredString(formData.get("body")) ||
    "This is a safe delivery test from Codexdentist settings.";
  const allowedChannels = new Set(["EMAIL", "SMS", "ZALO"]);

  if (!allowedChannels.has(channel) || !recipient) {
    redirect("/settings?notice=settings-notification-test-missing");
  }

  try {
    const notification = await prisma.notification.create({
      data: {
        organizationId: session.organizationId,
        clinicId: session.activeClinicId,
        userId: databaseActorId(session.userId),
        channel: channel as "EMAIL" | "SMS" | "ZALO",
        status: "DRAFT",
        templateKey: "SETTINGS_TEST",
        recipient,
        subject,
        body,
        metadata: {
          source: "settings_test",
        } satisfies Prisma.InputJsonObject,
      },
      select: {
        id: true,
      },
    });

    const result = await processNotificationNow(notification.id);
    const firstResult = result.results[0];

    await writeSettingsAuditLog({
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      action: "notification.test_sent",
      entityType: "Notification",
      entityId: notification.id,
      metadata: {
        channel,
        recipient,
        mode: result.mode,
        result: firstResult?.status ?? "unknown",
        reason: firstResult?.reason ?? null,
      },
    });

    if (firstResult?.status === "failed") {
      redirect("/settings?notice=settings-notification-test-failed");
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    redirect("/settings?notice=settings-notification-test-failed");
  }

  revalidatePath("/settings");
  revalidatePath("/dashboard");
  redirect("/settings?notice=settings-notification-test-sent");
}

export async function toggleStaffStatusAction(formData: FormData) {
  const session = await requireViewSession("settings");

  if (!canWriteSettings(session)) {
    redirect("/settings?notice=settings-denied");
  }

  const userId = requiredString(formData.get("userId"));
  const active = requiredString(formData.get("active")) === "true";

  if (!userId || userId === session.userId) {
    redirect("/settings?notice=settings-user-not-found");
  }

  let notice: string | null = null;

  try {
    const user = await findScopedUser(session, userId);

    if (!user) {
      notice = "settings-user-not-found";
    } else {
      assertCanManageStaffTarget(session, user);
      if (!active && staffUserHasRole(user, "OWNER")) {
        await assertAnotherActiveOwner(user.organizationId, user.id);
      }
      await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          active,
        },
      });

      await writeSettingsAuditLog({
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: active ? "staff.activated" : "staff.deactivated",
        entityId: userId,
      });
    }
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }
    notice = "settings-database";
  }

  if (notice) {
    redirect(`/settings?notice=${notice}`);
  }

  revalidatePath("/settings");
  redirect("/settings?notice=settings-status-updated");
}

async function findScopedUser(session: AppSession, userId: string) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      organizationId: session.organizationId,
      ...(canUseAllClinics(session)
        ? {}
        : {
            clinics: {
              some: {
                clinicId: {
                  in: session.clinicIds,
                },
              },
            },
          }
      ),
    },
    select: {
      id: true,
      organizationId: true,
      email: true,
      fullName: true,
      role: true,
      active: true,
      clinics: {
        select: {
          clinicId: true,
        },
      },
      roleAssignments: {
        where: {
          active: true,
        },
        select: {
          role: true,
        },
      },
    },
  });
}

function assertCanManageStaffTarget(
  session: AppSession,
  target: NonNullable<Awaited<ReturnType<typeof findScopedUser>>>,
) {
  if (isSuperAdminSession(session) && target.id !== session.userId) {
    return;
  }

  const actorRank = strongestRoleRank(effectiveRoles(session));
  const targetRank = strongestRoleRank([
    target.role,
    ...target.roleAssignments.map((assignment) => assignment.role),
  ]);

  if (actorRank >= targetRank) {
    redirect("/settings?notice=settings-denied");
  }
}

function canAssignStaffRoles(
  session: AppSession,
  roles: Array<Exclude<(typeof userRoles)[number], "PATIENT">>,
) {
  if (isSuperAdminSession(session)) {
    return true;
  }

  const actorRank = strongestRoleRank(effectiveRoles(session));
  return roles.every((role) => actorRank < strongestRoleRank([role]));
}

function staffUserHasRole(
  target: NonNullable<Awaited<ReturnType<typeof findScopedUser>>>,
  role: AppRole,
) {
  return (
    target.role === role ||
    target.roleAssignments.some((assignment) => assignment.role === role)
  );
}

async function assertAnotherActiveOwner(organizationId: string, excludedUserId: string) {
  const activeOwner = await prisma.user.findFirst({
    where: {
      organizationId,
      id: {
        not: excludedUserId,
      },
      active: true,
      OR: [
        {
          role: "OWNER",
        },
        {
          roleAssignments: {
            some: {
              active: true,
              role: "OWNER",
            },
          },
        },
      ],
    },
    select: {
      id: true,
    },
  });

  if (!activeOwner) {
    redirect("/settings?notice=settings-denied");
  }
}

function strongestRoleRank(roles: AppRole[]) {
  return Math.min(
    ...roles.map((role) => {
      const rank = staffRolePriority.indexOf(
        role as (typeof staffRolePriority)[number],
      );
      return rank === -1 ? Number.MAX_SAFE_INTEGER : rank;
    }),
  );
}

async function findChainOwnerCandidate(session: AppSession, userId: string) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      organizationId: session.organizationId,
      active: true,
      OR: [
        {
          role: {
            in: ["OWNER", "AREA_MANAGER"],
          },
        },
        {
          roleAssignments: {
            some: {
              active: true,
              role: {
                in: ["OWNER", "AREA_MANAGER"],
              },
            },
          },
        },
      ],
    },
    select: {
      id: true,
      organizationId: true,
    },
  });
}

function canWriteSettings(session: AppSession) {
  return canPerformAction(session, "settings.manage");
}

function canManageClinics(session: AppSession) {
  return canWriteSettings(session) && canUseAllClinics(session);
}

async function findScopedClinic(session: AppSession, clinicId: string) {
  if (isSuperAdminSession(session)) {
    return prisma.clinic.findFirst({
      where: {
        id: clinicId,
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
  }

  return prisma.clinic.findFirst({
    where: {
      organizationId: session.organizationId,
      ...(canUseAllClinics(session)
        ? {
            id: clinicId,
          }
        : {
            id: {
              equals: clinicId,
              in: session.clinicIds,
            },
          }),
    },
    select: {
      id: true,
      organizationId: true,
    },
  });
}

async function findActiveScopedClinic(session: AppSession, clinicId: string) {
  if (isSuperAdminSession(session)) {
    return prisma.clinic.findFirst({
      where: {
        id: clinicId,
        active: true,
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
  }

  return prisma.clinic.findFirst({
    where: {
      organizationId: session.organizationId,
      active: true,
      ...(canUseAllClinics(session)
        ? {
            id: clinicId,
          }
        : {
            id: {
              equals: clinicId,
              in: session.clinicIds,
            },
          }),
    },
    select: {
      id: true,
      organizationId: true,
    },
  });
}

async function findScopedChair(session: AppSession, chairId: string, clinicId: string) {
  const scopedClinic = await findScopedClinic(session, clinicId);

  if (!scopedClinic) {
    return null;
  }

  return prisma.chair.findFirst({
    where: {
      id: chairId,
      clinicId,
    },
    select: {
      id: true,
      clinic: {
        select: {
          organizationId: true,
        },
      },
    },
  });
}

async function targetClinicOrganizationId(session: AppSession, organizationIdInput: string | null) {
  if (!isSuperAdminSession(session)) {
    return session.organizationId;
  }

  const organizationId = organizationIdInput || session.organizationId;
  const organization = await prisma.organization.findUnique({
    where: {
      id: organizationId,
    },
    select: {
      id: true,
    },
  });

  if (!organization) {
    redirect("/settings?notice=settings-organization-missing");
  }

  return organization.id;
}

async function findScopedChain(session: AppSession, chainId: string) {
  return prisma.chain.findFirst({
    where: {
      id: chainId,
      organizationId: session.organizationId,
    },
    select: {
      id: true,
    },
  });
}

async function findActiveScopedChain(session: AppSession, chainId: string) {
  return prisma.chain.findFirst({
    where: {
      id: chainId,
      organizationId: session.organizationId,
      active: true,
    },
    select: {
      id: true,
    },
  });
}

async function findDefaultActiveChain(session: AppSession) {
  return prisma.chain.findFirst({
    where: {
      organizationId: session.organizationId,
      active: true,
    },
    orderBy: {
      name: "asc",
    },
    select: {
      id: true,
    },
  });
}

function isUserRole(role: string): role is (typeof userRoles)[number] {
  return userRoles.includes(role as (typeof userRoles)[number]);
}

function isStaffProfileRole(role: string): role is Exclude<(typeof userRoles)[number], "PATIENT"> {
  return staffProfileRoles.includes(role as Exclude<(typeof userRoles)[number], "PATIENT">);
}

function isOrganizationScopedRole(role: string): role is (typeof organizationScopedRoles)[number] {
  return organizationScopedRoles.includes(role as (typeof organizationScopedRoles)[number]);
}

function primaryStaffRoleForAssignments(
  roles: Array<Exclude<(typeof userRoles)[number], "PATIENT">>,
) {
  const roleSet = new Set(roles);

  return staffRolePriority.find((role) => roleSet.has(role)) ?? "FRONT_DESK";
}

function roleAssignmentData(
  organizationId: string,
  userId: string,
  role: Exclude<(typeof userRoles)[number], "PATIENT">,
  clinicId: string | null,
) {
  const scopedClinicId = isOrganizationScopedRole(role) ? null : clinicId;

  return {
    organizationId,
    userId,
    role,
    clinicId: scopedClinicId,
    scopeKey: scopedClinicId ?? "GLOBAL",
    active: true,
  };
}

function optionalString(value: FormDataEntryValue | null) {
  const text = requiredString(value).trim();

  return text || null;
}

function optionalDate(value: FormDataEntryValue | null): Date | null | false {
  const text = optionalString(value);

  if (!text) {
    return null;
  }

  const date = new Date(`${text}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? false : date;
}

function optionalDecimal(value: FormDataEntryValue | null): string | null | false {
  const text = optionalString(value);

  if (!text) {
    return null;
  }

  const compact = text.replaceAll(" ", "");
  const normalized =
    compact.includes(",") && !compact.includes(".")
      ? compact.replaceAll(",", ".")
      : compact.replaceAll(",", "");
  const decimal =
    normalized.split(".").length > 2 ? normalized.replaceAll(".", "") : normalized;

  return /^\d+(\.\d{1,2})?$/.test(decimal) ? decimal : false;
}

function defaultEmployeeCode(userId: string) {
  return `NV-${userId.replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase()}`;
}

function defaultRoleTitle(role: AppRole) {
  const labels: Record<AppRole, string> = {
    OWNER: "Owner",
    AREA_MANAGER: "Area manager",
    CLINIC_MANAGER: "Clinic manager",
    DENTIST: "Dentist",
    HYGIENIST: "Hygienist",
    FRONT_DESK: "Front desk",
    BILLING: "Billing",
    PATIENT: "Patient",
  };

  return labels[role] ?? role;
}

async function writeSettingsAuditLog(input: {
  organizationId: string;
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType ?? "User",
      entityId: input.entityId,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
    },
  });
}

async function createPasswordSetupNotification(input: {
  organizationId: string;
  clinicId: string | null;
  userId: string;
  email: string;
  fullName: string;
  setupUrl: string;
  expiresAt: Date;
}) {
  const rendered = renderNotificationTemplate("STAFF_PASSWORD_SETUP", {
    fullName: input.fullName,
    setupUrl: input.setupUrl,
    expiresAt: input.expiresAt.toISOString(),
  });
  const notification = await prisma.notification.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId,
      userId: input.userId,
      channel: "EMAIL",
      status: "SCHEDULED",
      templateKey: "STAFF_PASSWORD_SETUP",
      recipient: input.email,
      subject: rendered.subject,
      body: "A one-time password setup email was requested for this account.",
      scheduledAt: new Date(),
      metadata: {
        purpose: "STAFF_PASSWORD_SETUP",
      } as Prisma.InputJsonValue,
    },
  });

  return {
    id: notification.id,
    deliveryContent: rendered,
  };
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

function isUniqueConstraintError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

import { readFileSync, writeFileSync } from "node:fs";

const path = "src/app/(app)/settings/actions.ts";
let source = readFileSync(path, "utf8");

source = replaceExact(
  source,
  'import { randomBytes } from "crypto";',
  'import { createHash, randomBytes } from "crypto";',
);
source = replaceExact(
  source,
  'import { databaseActorId, requiredString } from "@/lib/form-validation";',
  'import { appBaseUrl } from "@/lib/env";\nimport { databaseActorId, requiredString } from "@/lib/form-validation";',
);
source = replaceExact(
  source,
  'import { createPasswordSetupToken } from "@/lib/password-reset";\n',
  "",
);

source = replaceFunction(
  source,
  "createOrganizationAction",
  "createStaffAction",
  `export async function createOrganizationAction(formData: FormData) {
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

  const domain = tenantDomainForSlug(slug);
  let result: {
    organization: {
      id: string;
      name: string;
      slug: string | null;
      primaryDomain: string | null;
    };
    owner: { id: string; email: string; fullName: string };
    setup: PasswordSetupArtifacts;
  } | null = null;

  try {
    const existingOwner = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });

    if (existingOwner) {
      redirect("/settings?notice=settings-email-exists");
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

      return { organization, owner, setup };
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-organization-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  if (!result) {
    redirect("/settings?notice=settings-database");
  }

  try {
    await bootstrapOrganizationDefaults({
      organizationId: result.organization.id,
      organizationName: result.organization.name,
      organizationSlug: result.organization.slug,
      organizationDomain: result.organization.primaryDomain,
      ownerUserId: result.owner.id,
      ownerEmail: result.owner.email,
      ownerFullName: result.owner.fullName,
    });
  } catch (error) {
    console.error("organization.bootstrap_failed", error);
    await prisma.auditLog
      .create({
        data: {
          organizationId: result.organization.id,
          actorId: null,
          action: "organization.bootstrap_failed",
          entityType: "Organization",
          entityId: result.organization.id,
          metadata: {
            retryable: true,
          },
        },
      })
      .catch(() => null);
  }

  await deliverSetupNotification(result.setup);
  revalidatePath("/settings");
  redirect(
    "/settings?notice=settings-organization-created&domain=" +
      encodeURIComponent(domain),
  );
}`,
);

source = replaceFunction(
  source,
  "createStaffAction",
  "createStaffPasswordSetupLinkAction",
  `export async function createStaffAction(formData: FormData) {
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

  let result: { userId: string; setup: PasswordSetupArtifacts } | null = null;

  try {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      redirect("/settings?notice=settings-email-exists");
    }

    result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          organizationId: targetOrganizationId,
          email,
          fullName,
          passwordHash: hashPassword(randomBytes(32).toString("base64url")),
          role,
          active: true,
          mustChangePassword: true,
          clinics: {
            create: { clinicId },
          },
        },
        select: { id: true },
      });
      await tx.userRoleAssignment.createMany({
        data: createAssignmentRoles.map((assignmentRole) =>
          roleAssignmentData(targetOrganizationId, user.id, assignmentRole, clinicId),
        ),
        skipDuplicates: true,
      });
      await tx.staffProfile.create({
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
      const setup = await createPasswordSetupArtifactsTx(tx, {
        organizationId: targetOrganizationId,
        userId: user.id,
        createdById: databaseActorId(session.userId),
        email,
        fullName,
        clinicId,
      });
      await tx.auditLog.create({
        data: {
          organizationId: targetOrganizationId,
          actorId: databaseActorId(session.userId),
          action: "staff.created",
          entityType: "User",
          entityId: user.id,
          metadata: {
            email,
            derivedRole: role,
            assignmentRoles: createAssignmentRoles,
            clinicId,
            createdFromOrganizationId: session.organizationId,
          },
        },
      });

      return { userId: user.id, setup };
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (isUniqueConstraintError(error)) {
      redirect("/settings?notice=settings-email-exists");
    }
    redirect("/settings?notice=settings-database");
  }

  if (!result) {
    redirect("/settings?notice=settings-database");
  }

  await deliverSetupNotification(result.setup);
  revalidatePath("/settings");
  redirect(
    "/settings?notice=settings-staff-created&setupEmail=" +
      encodeURIComponent(email),
  );
}`,
);

source = replaceFunction(
  source,
  "createStaffPasswordSetupLinkAction",
  "createClinicAction",
  `export async function createStaffPasswordSetupLinkAction(formData: FormData) {
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

  const user = await findScopedUser(session, userId);
  if (!user) {
    redirect("/settings?notice=settings-user-not-found");
  }
  assertCanManageStaffTarget(session, user);

  let setup: PasswordSetupArtifacts | null = null;
  try {
    setup = await prisma.$transaction(async (tx) => {
      const artifacts = await createPasswordSetupArtifactsTx(tx, {
        organizationId: session.organizationId,
        userId: user.id,
        createdById: databaseActorId(session.userId),
        email: user.email,
        fullName: user.fullName,
        clinicId:
          user.clinics[0]?.clinicId ??
          session.activeClinicId ??
          session.clinicIds[0] ??
          null,
      });
      await tx.user.update({
        where: { id: user.id },
        data: { mustChangePassword: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorId: databaseActorId(session.userId),
          action: "staff.password_setup_link_created",
          entityType: "User",
          entityId: user.id,
        },
      });
      return artifacts;
    });
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    redirect("/settings?notice=settings-database");
  }

  if (!setup) {
    redirect("/settings?notice=settings-database");
  }

  await deliverSetupNotification(setup);
  revalidatePath("/settings");
  redirect(
    "/settings?notice=settings-password-link-created&setupEmail=" +
      encodeURIComponent(user.email),
  );
}`,
);

source = replaceFunction(
  source,
  "createChainAction",
  "updateChainAction",
  `export async function createChainAction(formData: FormData) {
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

  let existingOwnerId: string | null = null;
  if (ownerMode === "existing" && ownerUserId) {
    const owner = await findChainOwnerCandidate(session, ownerUserId);
    if (!owner) {
      redirect("/settings?notice=settings-chain-owner-missing");
    }
    existingOwnerId = owner.id;
  }

  if (ownerMode === "new") {
    if (!canAssignStaffRoles(session, ["AREA_MANAGER"])) {
      redirect("/settings?notice=settings-denied");
    }
    if (!ownerFullName || !ownerEmail) {
      redirect("/settings?notice=settings-chain-owner-missing");
    }
    const existingOwner = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true },
    });
    if (existingOwner) {
      redirect("/settings?notice=settings-email-exists");
    }
  }

  let setup: PasswordSetupArtifacts | null = null;
  try {
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
          data: roleAssignmentData(
            session.organizationId,
            owner.id,
            "AREA_MANAGER",
            null,
          ),
        });
        ownerSetup = await createPasswordSetupArtifactsTx(tx, {
          organizationId: session.organizationId,
          organizationDomain: session.organizationDomain,
          organizationSlug: session.organizationSlug,
          userId: owner.id,
          createdById: databaseActorId(session.userId),
          email: ownerEmail,
          fullName: ownerFullName,
          clinicId: session.activeClinicId ?? session.clinicIds[0] ?? null,
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
  } catch (error) {
    if (isNextRedirect(error)) throw error;
    if (isUniqueConstraintError(error)) {
      redirect(
        ownerMode === "new"
          ? "/settings?notice=settings-email-exists"
          : "/settings?notice=settings-chain-exists",
      );
    }
    redirect("/settings?notice=settings-database");
  }

  if (setup) {
    await deliverSetupNotification(setup);
  }

  revalidatePath("/settings");
  redirect(
    ownerMode === "new" && ownerEmail
      ? "/settings?notice=settings-chain-created&setupEmail=" +
          encodeURIComponent(ownerEmail)
      : "/settings?notice=settings-chain-created",
  );
}`,
);

source = replaceHelper(
  source,
  "async function createPasswordSetupNotification",
  "function isNextRedirect",
  `type PasswordSetupArtifacts = {
  notificationId: string;
  deliveryContent: ReturnType<typeof renderNotificationTemplate>;
};

async function createPasswordSetupArtifactsTx(
  tx: Prisma.TransactionClient,
  input: {
    organizationId: string;
    organizationDomain?: string | null;
    organizationSlug?: string | null;
    userId: string;
    createdById: string | null;
    email: string;
    fullName: string;
    clinicId?: string | null;
  },
): Promise<PasswordSetupArtifacts> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() +
      (process.env.NODE_ENV === "production"
        ? 60 * 60 * 1000
        : 24 * 60 * 60 * 1000),
  );

  await tx.passwordResetToken.updateMany({
    where: {
      userId: input.userId,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });
  await tx.passwordResetToken.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      createdById: input.createdById,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      purpose: "STAFF_PASSWORD_SETUP",
      expiresAt,
    },
  });

  let organizationDomain = input.organizationDomain ?? null;
  let organizationSlug = input.organizationSlug ?? null;
  if (!organizationDomain && !organizationSlug) {
    const organization = await tx.organization.findUnique({
      where: { id: input.organizationId },
      select: { primaryDomain: true, slug: true },
    });
    organizationDomain = organization?.primaryDomain ?? null;
    organizationSlug = organization?.slug ?? null;
  }

  const domain =
    organizationDomain?.trim() ||
    (organizationSlug ? tenantDomainForSlug(organizationSlug) : "");
  const baseUrl = passwordSetupBaseUrl(domain);
  const setupUrl =
    baseUrl + "/reset-password?token=" + encodeURIComponent(token);
  const rendered = renderNotificationTemplate("STAFF_PASSWORD_SETUP", {
    fullName: input.fullName,
    setupUrl,
    expiresAt: expiresAt.toISOString(),
  });
  const notification = await tx.notification.create({
    data: {
      organizationId: input.organizationId,
      clinicId: input.clinicId ?? null,
      userId: input.userId,
      channel: "EMAIL",
      status: "SCHEDULED",
      templateKey: "STAFF_PASSWORD_SETUP",
      recipient: input.email,
      subject: rendered.subject,
      body: "A one-time password setup email was requested for this account.",
      scheduledAt: now,
      metadata: {
        purpose: "STAFF_PASSWORD_SETUP",
      },
    },
    select: { id: true },
  });

  return {
    notificationId: notification.id,
    deliveryContent: rendered,
  };
}

function passwordSetupBaseUrl(domain: string) {
  if (!domain) {
    return appBaseUrl();
  }

  const trimmedDomain = domain.trim().replace(/\\/+$/, "");
  if (/^https?:\\/\\//i.test(trimmedDomain)) {
    return new URL(trimmedDomain).toString().replace(/\\/+$/, "");
  }

  const protocol = new URL(appBaseUrl()).protocol;
  return protocol + "//" + trimmedDomain;
}

async function deliverSetupNotification(setup: PasswordSetupArtifacts) {
  try {
    const result = await processNotificationNow(
      setup.notificationId,
      setup.deliveryContent,
    );
    if (result.results[0]?.status === "failed") {
      console.error(
        "staff.password_setup_delivery_failed",
        result.results[0]?.reason ?? "unknown",
      );
    }
  } catch (error) {
    console.error("staff.password_setup_delivery_failed", error);
  }
}`,
);

writeFileSync(path, source);
console.log("Patched transactional settings actions.");

function replaceFunction(text, name, nextName, replacement) {
  return replaceBetween(
    text,
    `export async function ${name}`,
    `export async function ${nextName}`,
    replacement,
  );
}

function replaceHelper(text, marker, nextMarker, replacement) {
  return replaceBetween(text, marker, nextMarker, replacement);
}

function replaceBetween(text, startMarker, nextMarker, replacement) {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error(`Missing start marker: ${startMarker}`);
  const end = text.indexOf(nextMarker, start + startMarker.length);
  if (end < 0) throw new Error(`Missing end marker: ${nextMarker}`);
  return text.slice(0, start) + replacement + "\n\n" + text.slice(end);
}

function replaceExact(text, from, to) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`Missing exact text: ${from}`);
  if (text.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected exact text once: ${from}`);
  }
  return text.slice(0, first) + to + text.slice(first + from.length);
}

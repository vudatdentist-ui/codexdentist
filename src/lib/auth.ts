import "server-only";

import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { writeAuditLog } from "@/lib/audit";
import { clinics as demoClinics } from "@/lib/data";
import {
  canAccessView,
  canUseAllClinics,
  defaultViewForRole,
  primaryRoleForRoles,
  type AppRole,
  type ViewKey,
} from "@/lib/permissions";
import { authSecret, demoAuthEnabled, sessionCookieSecure } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { superAdminEmails } from "@/lib/super-admin";
import {
  currentHostname,
  findTenantOrganization,
  isNeutralAppHostname,
  tenantSlugFromHostname,
} from "@/lib/tenant";

const SESSION_COOKIE = "nhavista_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const PASSWORD_ITERATIONS = 310000;

const demoUsers = [
  {
    userId: "demo-owner",
    email: "owner@nhavista.vn",
    password: "demo1234",
    fullName: "Nguyen Lan Anh",
    role: "OWNER" as const,
  },
  {
    userId: "demo-manager",
    email: "manager@nhavista.vn",
    password: "demo1234",
    fullName: "Tran Quoc Minh",
    role: "CLINIC_MANAGER" as const,
  },
  {
    userId: "demo-dentist",
    email: "dentist@nhavista.vn",
    password: "demo1234",
    fullName: "Dr. Linh Tran",
    role: "DENTIST" as const,
  },
  {
    userId: "demo-frontdesk",
    email: "frontdesk@nhavista.vn",
    password: "demo1234",
    fullName: "Pham Gia Han",
    role: "FRONT_DESK" as const,
  },
  {
    userId: "demo-billing",
    email: "billing@nhavista.vn",
    password: "demo1234",
    fullName: "Le Hoang Bao",
    role: "BILLING" as const,
  },
  {
    userId: "demo-area",
    email: "area@nhavista.vn",
    password: "demo1234",
    fullName: "Ho Thi Mai",
    role: "AREA_MANAGER" as const,
  },
  {
    userId: "demo-hygienist",
    email: "hygienist@nhavista.vn",
    password: "demo1234",
    fullName: "Nguyen Thao Vy",
    role: "HYGIENIST" as const,
  },
  {
    userId: "demo-patient",
    email: "patient@nhavista.vn",
    password: "demo1234",
    fullName: "Nguyen Minh Anh",
    role: "PATIENT" as const,
  },
];

export function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    32,
    "sha256",
  ).toString("hex");

  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password: string, passwordHash: string) {
  const [algorithm, iterationsRaw, salt, expectedHash] = passwordHash.split("$");

  if (algorithm !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expectedHash) {
    return false;
  }

  const iterations = Number(iterationsRaw);
  const actualHash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");

  return safeEqual(actualHash, expectedHash);
}

export async function signIn(
  email: string,
  password: string,
  options?: {
    allowNeutralDemo?: boolean;
  },
) {
  const normalizedEmail = email.trim().toLowerCase();
  const hostname = await currentHostname();
  const tenantSlug = tenantSlugFromHostname(hostname);
  const tenant = tenantSlug ? await findTenantOrganization(tenantSlug) : null;

  if (tenantSlug && !tenant) {
    return { ok: false as const, reason: "tenant-not-found" as const };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        organization: {
          include: {
            clinics: {
              where: {
                active: true,
              },
              select: {
                id: true,
                name: true,
                city: true,
              },
            },
          },
        },
        clinics: {
          include: {
            clinic: {
              select: {
                id: true,
                name: true,
                city: true,
                active: true,
              },
            },
          },
        },
        roleAssignments: {
          where: {
            active: true,
          },
          select: {
            role: true,
            organizationId: true,
            clinicId: true,
          },
        },
      },
    });

    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      if (user) {
        await writeAuditLog({
          organizationId: user.organizationId,
          action: "auth.login_failed",
          entityType: "User",
          entityId: user.id,
          metadata: {
            email: normalizedEmail,
            reason: !user.active ? "inactive" : "invalid-password",
          },
        });
      }

      return { ok: false as const, reason: "invalid" as const };
    }

    if (
      user.organization.isDemo &&
      (!user.organization.demoExpiresAt ||
        user.organization.demoExpiresAt.getTime() <= Date.now())
    ) {
      return { ok: false as const, reason: "expired" as const };
    }

    if (tenant && user.organizationId !== tenant.id) {
      await writeAuditLog({
        organizationId: user.organizationId,
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        metadata: {
          email: normalizedEmail,
          reason: "wrong-tenant",
          hostname,
        },
      });
      return { ok: false as const, reason: "invalid" as const };
    }

    const isAllowedNeutralDemo =
      options?.allowNeutralDemo === true && user.organization.isDemo;

    if (
      !tenant &&
      isNeutralAppHostname(hostname) &&
      !isSuperAdminEmail(normalizedEmail) &&
      !isAllowedNeutralDemo
    ) {
      await writeAuditLog({
        organizationId: user.organizationId,
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        metadata: {
          email: normalizedEmail,
          reason: "neutral-host-denied",
          hostname,
        },
      });
      return { ok: false as const, reason: "invalid" as const };
    }

    if (user.mustChangePassword) {
      await writeAuditLog({
        organizationId: user.organizationId,
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        metadata: {
          email: normalizedEmail,
          reason: "password-change-required",
        },
      });
      return { ok: false as const, reason: "password-change-required" as const };
    }

    const roleAssignments = normalizeRoleAssignments(
      user.role as AppRole,
      user.organizationId,
      user.roleAssignments,
    );
    const roles = rolesFromAssignments(roleAssignments);
    const role = primaryRoleForRoles(roles);
    const scopedClinics = canUseAllClinics({ role, roles, roleAssignments })
      ? user.organization.clinics
      : user.clinics
          .map((membership) => membership.clinic)
          .filter((clinic) => clinic.active);

    const session = createSession({
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role,
      roles,
      roleAssignments,
      organizationId: user.organizationId,
      organizationName: user.organization.name,
      organizationSlug: user.organization.slug,
      organizationDomain: user.organization.primaryDomain,
      isDemo: user.organization.isDemo,
      workspaceExpiresAt: user.organization.demoExpiresAt?.getTime() ?? null,
      clinics: scopedClinics,
      ttlSeconds: user.organization.isDemo
        ? Math.max(
            60,
            Math.floor(
              ((user.organization.demoExpiresAt?.getTime() ?? Date.now()) - Date.now()) /
                1000,
            ),
          )
        : undefined,
    });

    await Promise.all([
      prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(session.sessionId),
          activeClinicId: session.activeClinicId,
          expiresAt: new Date(session.expiresAt),
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    await setSessionCookie(session);
    await writeAuditLog({
      session,
      organizationId: user.organizationId,
      action: "auth.login_success",
      entityType: "User",
      entityId: user.id,
      metadata: {
        email: normalizedEmail,
        hostname,
      },
    });

    return { ok: true as const };
  } catch {
    if (process.env.NODE_ENV === "production" || !demoAuthEnabled()) {
      return { ok: false as const, reason: "database" as const };
    }

    const demoUser = demoUsers.find(
      (candidate) =>
        candidate.email === normalizedEmail && candidate.password === password,
    );

    if (!demoUser) {
      return { ok: false as const, reason: "invalid" as const };
    }

    await setSessionCookie(
      createSession({
        userId: demoUser.userId,
        email: demoUser.email,
        fullName: demoUser.fullName,
        role: demoUser.role,
        organizationId: "demo-org",
        organizationName: "Codexdentist",
        organizationSlug: null,
        organizationDomain: null,
        isDemo: false,
        workspaceExpiresAt: null,
        clinics: demoClinics.map((clinic) => ({
          id: clinic.id,
          name: clinic.name,
          city: clinic.city,
        })),
      }),
    );

    return { ok: true as const };
  }
}

export async function signOut() {
  const session = await getSession();

  if (session) {
    try {
      await prisma.session.deleteMany({
        where: {
          tokenHash: hashToken(session.sessionId),
        },
      });
      await writeAuditLog({
        session,
        organizationId: session.organizationId,
        action: "auth.logout",
        entityType: "User",
        entityId: session.userId,
      });
    } catch {
      // The signed cookie is the source of truth for demo/offline mode.
    }
  }

  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const rawCookie = cookieStore.get(SESSION_COOKIE)?.value;

  if (!rawCookie) {
    return null;
  }

  const session = verifySignedPayload(rawCookie);

  if (!session || session.expiresAt < Date.now()) {
    return null;
  }

  if (isFallbackDemoSession(session)) {
    return process.env.NODE_ENV === "production" ? null : session;
  }

  const hostname = await currentHostname();
  const tenantSlug = tenantSlugFromHostname(hostname);

  if (tenantSlug && session.organizationSlug !== tenantSlug) {
    return null;
  }

  if (
    !tenantSlug &&
    isNeutralAppHostname(hostname) &&
    !isSuperAdminEmail(session.email) &&
    !session.isDemo
  ) {
    return null;
  }

  try {
    const storedSession = await prisma.session.findFirst({
      where: {
        tokenHash: hashToken(session.sessionId),
        userId: session.userId,
        expiresAt: {
          gt: new Date(),
        },
        user: {
          active: true,
          organizationId: session.organizationId,
        },
      },
      select: {
        activeClinicId: true,
        user: {
          select: {
            email: true,
            fullName: true,
            role: true,
            organizationId: true,
            organization: {
              select: {
                name: true,
                slug: true,
                primaryDomain: true,
                isDemo: true,
                demoExpiresAt: true,
                clinics: {
                  where: {
                    active: true,
                  },
                  select: {
                    id: true,
                    name: true,
                    city: true,
                  },
                },
              },
            },
            clinics: {
              include: {
                clinic: {
                  select: {
                    id: true,
                    name: true,
                    city: true,
                    active: true,
                  },
                },
              },
            },
            roleAssignments: {
              where: {
                active: true,
              },
              select: {
                role: true,
                organizationId: true,
                clinicId: true,
              },
            },
          },
        },
      },
    });

    if (!storedSession) {
      return null;
    }

    if (
      storedSession.user.organization.isDemo &&
      (!storedSession.user.organization.demoExpiresAt ||
        storedSession.user.organization.demoExpiresAt.getTime() <= Date.now())
    ) {
      return null;
    }

    const roleAssignments = normalizeRoleAssignments(
      storedSession.user.role as AppRole,
      storedSession.user.organizationId,
      storedSession.user.roleAssignments,
    );
    const roles = rolesFromAssignments(roleAssignments);
    const role = primaryRoleForRoles(roles);
    const clinics = canUseAllClinics({ role, roles, roleAssignments })
      ? storedSession.user.organization.clinics
      : storedSession.user.clinics
          .map((membership) => membership.clinic)
          .filter((clinic) => clinic.active);
    const clinicIds = clinics.map((clinic) => clinic.id);
    const activeClinicId = canUseAllClinics({ role, roles, roleAssignments })
      ? null
      : storedSession.activeClinicId && clinicIds.includes(storedSession.activeClinicId)
        ? storedSession.activeClinicId
        : clinicIds[0] ?? null;

    return {
      ...session,
      email: storedSession.user.email,
      fullName: storedSession.user.fullName,
      role,
      roles,
      roleAssignments,
      organizationId: storedSession.user.organizationId,
      organizationName: storedSession.user.organization.name,
      organizationSlug: storedSession.user.organization.slug,
      organizationDomain: storedSession.user.organization.primaryDomain,
      isDemo: storedSession.user.organization.isDemo,
      workspaceExpiresAt:
        storedSession.user.organization.demoExpiresAt?.getTime() ?? null,
      clinics,
      clinicIds,
      activeClinicId,
    };
  } catch {
    return null;
  }
}

export async function requireSession() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session;
}

export async function requireViewSession(view: ViewKey) {
  const session = await requireSession();

  if (!canAccessView(session, view)) {
    redirect(`/${defaultViewForRole(session)}`);
  }

  return session;
}

function createSession(input: {
  userId: string;
  email: string;
  fullName: string;
  role: AppRole;
  roles?: AppRole[];
  roleAssignments?: Array<{
    role: AppRole;
    organizationId: string;
    clinicId: string | null;
  }>;
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  organizationDomain: string | null;
  isDemo?: boolean;
  workspaceExpiresAt?: number | null;
  clinics: Array<{ id: string; name: string; city: string }>;
  ttlSeconds?: number;
}): AppSession {
  const clinicIds = input.clinics.map((clinic) => clinic.id);
  const roleAssignments =
    input.roleAssignments && input.roleAssignments.length > 0
      ? input.roleAssignments
      : [
          {
            role: input.role,
            organizationId: input.organizationId,
            clinicId: null,
          },
        ];
  const roles = input.roles && input.roles.length > 0 ? input.roles : rolesFromAssignments(roleAssignments);
  const role = primaryRoleForRoles(roles);

  return {
    sessionId: randomBytes(32).toString("hex"),
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    role,
    roles,
    roleAssignments,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    organizationSlug: input.organizationSlug,
    organizationDomain: input.organizationDomain,
    isDemo: input.isDemo ?? false,
    workspaceExpiresAt: input.workspaceExpiresAt ?? null,
    clinicIds,
    clinics: input.clinics,
    activeClinicId: canUseAllClinics({ role, roles, roleAssignments }) ? null : clinicIds[0] ?? null,
    expiresAt: Date.now() + (input.ttlSeconds ?? SESSION_TTL_SECONDS) * 1000,
  };
}

function normalizeRoleAssignments(
  legacyRole: AppRole,
  organizationId: string,
  assignments: Array<{
    role: string;
    organizationId: string;
    clinicId: string | null;
  }>,
) {
  if (assignments.length === 0) {
    return [
      {
        role: legacyRole,
        organizationId,
        clinicId: null,
      },
    ];
  }

  return assignments.map((assignment) => ({
    role: assignment.role as AppRole,
    organizationId: assignment.organizationId,
    clinicId: assignment.clinicId,
  }));
}

function rolesFromAssignments(
  assignments: Array<{
    role: AppRole;
  }>,
) {
  const roles = new Set<AppRole>();

  assignments.forEach((assignment) => roles.add(assignment.role));

  return [...roles];
}

async function setSessionCookie(session: AppSession) {
  const cookieStore = await cookies();
  const maxAge = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));

  cookieStore.set(SESSION_COOKIE, signPayload(session), {
    httpOnly: true,
    maxAge,
    path: "/",
    sameSite: "lax",
    secure: sessionCookieSecure(),
  });
}

function signPayload(session: AppSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");

  return `${payload}.${signature}`;
}

function verifySignedPayload(rawCookie: string) {
  const [payload, signature] = rawCookie.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = createHmac("sha256", authSecret())
    .update(payload)
    .digest("base64url");

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AppSession;
  } catch {
    return null;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isFallbackDemoSession(session: AppSession) {
  return session.organizationId === "demo-org";
}

function isSuperAdminEmail(email: string) {
  return superAdminEmails().includes(email.trim().toLowerCase());
}

function safeEqual(first: string, second: string) {
  const firstBuffer = Buffer.from(first);
  const secondBuffer = Buffer.from(second);

  return (
    firstBuffer.length === secondBuffer.length &&
    timingSafeEqual(firstBuffer, secondBuffer)
  );
}

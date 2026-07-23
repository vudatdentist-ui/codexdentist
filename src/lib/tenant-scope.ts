import "server-only";

import { canUseAllClinics } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

export function getOrgScope(session: AppSession) {
  return {
    organizationId: session.organizationId,
  };
}

export function accessibleClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

export function getClinicScope(session: AppSession) {
  return {
    organizationId: session.organizationId,
    clinicId: {
      in: accessibleClinicIds(session),
    },
  };
}

export function assertSameOrg(
  session: AppSession,
  resource: { organizationId?: string | null },
) {
  if (!resource.organizationId || resource.organizationId !== session.organizationId) {
    throw new TenantScopeError("Resource is outside the active organization.");
  }
}

export function assertClinicAccess(
  session: AppSession,
  resource: { clinicId?: string | null },
) {
  if (!resource.clinicId || !accessibleClinicIds(session).includes(resource.clinicId)) {
    throw new TenantScopeError("Resource is outside the active clinic scope.");
  }
}

export function assertTenantResource(
  session: AppSession,
  resource: { organizationId?: string | null; clinicId?: string | null },
) {
  assertSameOrg(session, resource);
  assertClinicAccess(session, resource);
}

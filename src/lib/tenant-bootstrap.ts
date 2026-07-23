import "server-only";

import { ensureAccountingCategories } from "@/lib/accounting";
import { ensureFormsSeed } from "@/lib/forms";
import { ensureInventorySeed } from "@/lib/inventory";
import { ensureLearningSeed } from "@/lib/learning";
import { ensurePharmacySeed } from "@/lib/pharmacy";
import { ensureServiceCatalogSeed } from "@/lib/services";
import type { AppSession } from "@/lib/session";

type BootstrapInput = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  organizationDomain: string | null;
  ownerUserId: string;
  ownerEmail: string;
  ownerFullName: string;
};

export async function bootstrapOrganizationDefaults(input: BootstrapInput) {
  const bootstrapSession: AppSession = {
    sessionId: "tenant-bootstrap",
    userId: input.ownerUserId,
    email: input.ownerEmail,
    fullName: input.ownerFullName,
    role: "OWNER",
    roles: ["OWNER"],
    roleAssignments: [
      {
        role: "OWNER",
        organizationId: input.organizationId,
        clinicId: null,
      },
    ],
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    organizationSlug: input.organizationSlug,
    organizationDomain: input.organizationDomain,
    isDemo: false,
    workspaceExpiresAt: null,
    clinicIds: [],
    clinics: [],
    activeClinicId: null,
    expiresAt: Date.now() + 60_000,
  };

  await ensureAccountingCategories(input.organizationId);
  await ensureServiceCatalogSeed(input.organizationId);
  await ensurePharmacySeed(bootstrapSession);
  await ensureFormsSeed(bootstrapSession);
  await ensureLearningSeed(bootstrapSession);
  await ensureInventorySeed(bootstrapSession);
}

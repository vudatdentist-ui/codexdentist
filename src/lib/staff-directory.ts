import "server-only";

import { prisma } from "@/lib/prisma";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import type { AppSession } from "@/lib/session";
import { canAccessView } from "@/lib/permissions";
import type { AppRole } from "@/lib/permissions";

export type StaffDirectoryMember = {
  id: string;
  fullName: string;
  active: boolean;
  roleAssignments: Array<{ role: AppRole; clinicId: string | null; active: boolean }>;
};

// A clinical participant picker must never load the administrative staff DTO.
export async function getStaffDirectory(session: AppSession): Promise<StaffDirectoryMember[]> {
  if (!canAccessView(session, "journey")) throw new Error("Staff directory read denied.");
  return prisma.user.findMany({
    where: {
      organizationId: session.organizationId,
      active: true,
      clinics: { some: { clinicId: { in: accessibleClinicIds(session) } } },
    },
    select: {
      id: true, fullName: true, active: true,
      roleAssignments: {
        where: { organizationId: session.organizationId, active: true,
          OR: [{ clinicId: null }, { clinicId: { in: accessibleClinicIds(session) } }] },
        select: { role: true, clinicId: true, active: true },
      },
    },
    orderBy: { fullName: "asc" },
  });
}

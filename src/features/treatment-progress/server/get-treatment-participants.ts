import "server-only";

import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

export type TreatmentParticipantOption = {
  id: string;
  fullName: string;
  role: string;
};

export async function getTreatmentParticipants(
  session: AppSession,
  clinicId: string,
): Promise<TreatmentParticipantOption[]> {
  if (!session.clinicIds.includes(clinicId)) {
    return [];
  }

  const users = await prisma.user.findMany({
    where: {
      organizationId: session.organizationId,
      active: true,
      roleAssignments: {
        some: {
          active: true,
          role: {
            not: "PATIENT",
          },
          OR: [
            {
              clinicId: null,
            },
            {
              clinicId,
            },
          ],
        },
      },
    },
    select: {
      id: true,
      fullName: true,
      role: true,
    },
    orderBy: {
      fullName: "asc",
    },
  });

  return users.map((user) => ({
    id: user.id,
    fullName: user.fullName,
    role: user.role,
  }));
}

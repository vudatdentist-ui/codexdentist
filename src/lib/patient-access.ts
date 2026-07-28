import "server-only";

import type { Prisma } from "@prisma/client";
import { hasAnyRole, canUseAllClinics, type AppRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";

const appointmentAccessRoles: AppRole[] = ["DENTIST", "HYGIENIST"];

export function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

export function patientAccessWhere(
  session: AppSession,
): Prisma.PatientWhereInput {
  if (session.role === "PATIENT") {
    return {
      organizationId: session.organizationId,
      portalUserId: session.userId,
    };
  }

  const clinicIds = allowedClinicIds(session);
  const directClinicAccess: Prisma.PatientWhereInput = {
    clinicId: {
      in: clinicIds,
    },
  };

  if (!hasAnyRole(session, appointmentAccessRoles)) {
    return {
      organizationId: session.organizationId,
      ...directClinicAccess,
    };
  }

  const { from, to } = clinicalAccessWindow();

  return {
    organizationId: session.organizationId,
    OR: [
      directClinicAccess,
      {
        appointments: {
          some: {
            providerId: session.userId,
            startsAt: {
              gte: from,
              lte: to,
            },
            status: {
              notIn: ["CANCELLED", "NO_SHOW"],
            },
          },
        },
      },
      {
        treatmentServices: {
          some: {
            createdById: session.userId,
          },
        },
      },
      {
        treatmentServices: {
          some: {
            progressEvents: {
              some: {
                OR: [
                  { consultantId: session.userId },
                  { performedById: session.userId },
                  { clinicalSupportId: session.userId },
                  { assistantPrimaryId: session.userId },
                  { assistantSecondaryId: session.userId },
                ],
              },
            },
          },
        },
      },
    ],
  };
}

export function clinicalAccessWindow(now = new Date()) {
  return {
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    to: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
}

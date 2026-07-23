import type { AppRole } from "@/lib/permissions";

export type AppSessionRoleAssignment = {
  role: AppRole;
  organizationId: string;
  clinicId: string | null;
};

export type AppSession = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  /**
   * Primary legacy role retained for older UI labels and compatibility.
   * Authorization should use roles/roleAssignments through permission helpers.
   */
  role: AppRole;
  roles: AppRole[];
  roleAssignments: AppSessionRoleAssignment[];
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  organizationDomain: string | null;
  isDemo: boolean;
  workspaceExpiresAt: number | null;
  clinicIds: string[];
  clinics: Array<{
    id: string;
    name: string;
    city: string;
  }>;
  activeClinicId: string | null;
  expiresAt: number;
};

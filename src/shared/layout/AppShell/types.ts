import type { AppRole } from "@/lib/permissions";

export type AppShellContext = {
  fullName: string;
  organizationName: string;
  role: AppRole;
  clinics: Array<{
    id: string;
    name: string;
  }>;
};

export type AppShellNotification = {
  id: string;
  title: string;
  detail: string;
  href: string;
  clinicName: string | null;
  createdAt: string;
};

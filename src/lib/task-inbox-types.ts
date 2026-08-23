export type TaskInboxPriority = "high" | "medium" | "low";

export type TaskInboxItemSummary = {
  id: string;
  sourceId: string | null;
  kind:
    | "crm"
    | "billing"
    | "inventory"
    | "hr"
    | "schedule"
    | "learning"
    | "notification";
  priority: TaskInboxPriority;
  title: string;
  detail: string;
  href: string;
  dueAt: string | null;
  patientName: string | null;
  clinicName: string | null;
  status: string;
  assignedToName: string | null;
  actionable: boolean;
  createdAt?: string | null;
  channel?: string | null;
  actionUrl?: string | null;
};

export type TaskInboxClinicOption = {
  id: string;
  name: string;
};

export type TaskInboxPatientOption = {
  id: string;
  name: string;
  phone: string;
  clinicId: string;
};

export type TaskInboxUserOption = {
  id: string;
  fullName: string;
  role: string;
  clinicIds: string[];
};

export type TaskInboxChainOption = {
  id: string;
  name: string;
};

export type TaskInboxWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  generatedAt: string;
  chains: TaskInboxChainOption[];
  clinics: TaskInboxClinicOption[];
  patients: TaskInboxPatientOption[];
  users: TaskInboxUserOption[];
  items: TaskInboxItemSummary[];
};

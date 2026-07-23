export type CrmPatientOption = {
  id: string;
  name: string;
  phone: string | null;
  clinicId: string;
};

export type CrmLeadSummary = {
  id: string;
  clinicId: string | null;
  patientId: string | null;
  ownerName: string | null;
  status: "NEW" | "CONTACTED" | "CONSULT_BOOKED" | "VISITED" | "CONVERTED" | "LOST" | "RECALL";
  source: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  campaignName: string | null;
  nextFollowUpAt: string | null;
  nextFollowUpAtIso: string | null;
  note: string | null;
  createdAt: string;
};

export type CrmActivitySummary = {
  id: string;
  clinicId: string | null;
  patientId: string | null;
  leadId: string | null;
  actorName: string | null;
  type: "CALL" | "ZALO" | "SMS" | "EMAIL" | "NOTE" | "TASK" | "VISIT" | "FOLLOW_UP";
  channel: "EMAIL" | "SMS" | "ZALO" | "PUSH" | "IN_APP" | "PHONE" | null;
  subject: string;
  body: string | null;
  dueAt: string | null;
  dueAtIso: string | null;
  completedAt: string | null;
  completedAtIso: string | null;
  createdAt: string;
  createdAtIso: string;
};

export type CrmWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patients: CrmPatientOption[];
  leads: CrmLeadSummary[];
  activities: CrmActivitySummary[];
};

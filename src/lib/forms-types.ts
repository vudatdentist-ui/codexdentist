export type FormsPatientOption = {
  id: string;
  name: string;
  phone: string | null;
  clinicId: string;
};

export type FormTemplateSummary = {
  id: string;
  type:
    | "CONSENT"
    | "INTAKE"
    | "MEDICAL_HISTORY"
    | "POST_OP"
    | "FINANCIAL_POLICY"
    | "CUSTOM";
  code: string;
  name: string;
  version: string;
  body: string | null;
  requiresSignature: boolean;
  active: boolean;
  createdAt: string;
  createdAtIso: string;
};

export type PatientFormSummary = {
  id: string;
  formNo: string;
  patientId: string;
  patientName: string;
  clinicId: string | null;
  templateId: string;
  templateCode: string;
  templateName: string;
  templateType: FormTemplateSummary["type"];
  templateVersion: string;
  templateBody: string | null;
  requiresSignature: boolean;
  requestedByName: string | null;
  status: "DRAFT" | "SENT" | "COMPLETED" | "EXPIRED" | "VOID";
  responseText: string | null;
  signatureUrl: string | null;
  attachments: string[];
  sentAt: string | null;
  sentAtIso: string | null;
  completedAt: string | null;
  completedAtIso: string | null;
  expiresAt: string | null;
  expiresAtIso: string | null;
  createdAt: string;
  createdAtIso: string;
};

export type FormsWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  patients: FormsPatientOption[];
  templates: FormTemplateSummary[];
  patientForms: PatientFormSummary[];
};

export type PrintableFormTemplate = {
  templateCode: string;
  templateName: string;
  templateType: FormTemplateSummary["type"];
  templateVersion: string;
  organizationName: string;
  clinicName: string;
  clinicCity: string;
  patientName: string;
  patientAge: string;
  patientPhone: string;
  patientAddress: string;
  visitReason: string;
  body: string;
  requiresSignature: boolean;
  printedAt: string;
};

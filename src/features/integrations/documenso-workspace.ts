export type DocumensoConnectionSummary = {
  id: string; clinicId: string | null; enabled: boolean; configured: boolean;
  webhookUrl: string; verifiedAt: string | null;
};
export type DocumensoSettingsWorkspace = {
  clinics: Array<{ id: string; name: string }>;
  canManageOrganization: boolean; isDemo: boolean; connections: DocumensoConnectionSummary[];
};
export type DocumensoRequestSummary = {
  id: string; status: "CREATING" | "DISTRIBUTING" | "PENDING" | "SIGNED" | "ERROR" | "FAILED" | "CANCELLED" | "UNKNOWN";
  sourcePatientFileId: string | null; idempotencyKey: string | null; envelopeId: string | null;
  signingUrl: string | null; signedFileUrl: string | null; updatedAt: string;
  canRetry: boolean; errorCode: "documenso-request-needs-attention" | null;
};
export type DocumensoConsentWorkspace = {
  patientFormId: string; patientId: string; formNo: string; status: string; requiresSignature: boolean;
  configured: boolean; canRequest: boolean; isDemo: boolean;
  recipient: { name: string; email: string | null };
  sources: Array<{ id: string; name: string }>;
  sourcePatientFileId: string | null; request: DocumensoRequestSummary | null;
  signedFileUrl: string | null;
};

// Both provider workspaces use the same HTTPS-only, credential-free URL policy.
export { payOSCheckoutUrl as documensoSigningUrl } from "./payos-workspace";

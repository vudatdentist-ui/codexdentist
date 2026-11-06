export type MedplumSyncStatus = "NEVER" | "PENDING" | "RETRY" | "VERIFIED" | "SOURCE_CHANGED";
export type MedplumPatientWorkspace = {
  status: MedplumSyncStatus;
  attempts: number;
  lastAttemptAt: string | null;
  lastVerifiedAt: string | null;
  errorCode: string | null;
};

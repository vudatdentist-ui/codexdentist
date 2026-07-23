export type PatientFileSummary = {
  id: string;
  patientId: string;
  patientName: string;
  clinicId: string;
  uploadedByName: string | null;
  category: string;
  title: string;
  fileName: string | null;
  mimeType: string | null;
  url: string;
  sizeBytes: number | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  virusScanStatus: string;
  retentionUntil: string | null;
  retentionUntilIso: string | null;
  sourceType: string | null;
  sourceId: string | null;
  notes: string | null;
  createdAt: string;
  createdAtIso: string;
};

export type PatientFilesWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  files: PatientFileSummary[];
};

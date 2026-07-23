export type PatientJourneyStateSummary = {
  id: string;
  patientId: string;
  clinicId: string;
  treatmentGoal: string;
  treatmentPlan: string;
  odontogramTeeth: string[];
  updatedAt: string;
  updatedByName: string | null;
};

export type JourneyCommentSummary = {
  id: string;
  patientId: string;
  clinicId: string;
  authorName: string;
  body: string;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachments: Array<{
    id: string;
    url: string;
    name: string | null;
    mimeType: string | null;
    fileKind: string | null;
    sizeBytes: number | null;
    previewUrl: string | null;
    thumbnailUrl: string | null;
    patientFileId: string | null;
  }>;
  createdAt: string;
  createdAtIso: string;
};

export type JourneyRecordsWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  states: PatientJourneyStateSummary[];
  comments: JourneyCommentSummary[];
};

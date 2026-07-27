import type { OdontogramData } from "codexdentist-odontogram";

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

export const odontogramStages = ["INITIAL", "EXPECTED", "CURRENT"] as const;
export type PatientOdontogramStage = (typeof odontogramStages)[number];

export type PatientOdontogramStageSummary = {
  snapshot: OdontogramData;
  revision: number;
  updatedAt: string;
  updatedAtIso: string;
};

export type PatientOdontogramSummary = {
  id: string;
  patientId: string;
  clinicId: string;
  stages: Record<
    PatientOdontogramStage,
    PatientOdontogramStageSummary | null
  >;
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
  odontograms: PatientOdontogramSummary[];
  comments: JourneyCommentSummary[];
};

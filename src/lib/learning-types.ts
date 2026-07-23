import type { AppRole } from "@/lib/permissions";

export type LearningClinicOption = {
  id: string;
  name: string;
};

export type LearningUserOption = {
  id: string;
  fullName: string;
  role: AppRole;
  active: boolean;
  clinicIds: string[];
};

export type LearningAssetSummary = {
  id: string;
  contentId: string;
  uploadedByName: string | null;
  kind: "document" | "image" | "model3d" | "pdf" | "video";
  title: string;
  fileName: string | null;
  mimeType: string | null;
  url: string;
  sizeBytes: number | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
};

export type LearningContentSummary = {
  id: string;
  clinicId: string | null;
  authorName: string | null;
  code: string;
  type: "BOOK" | "ARTICLE" | "VIDEO" | "COURSE" | "CHECKLIST" | "POLICY";
  title: string;
  summary: string | null;
  body: string | null;
  mediaUrl: string | null;
  durationMinutes: number | null;
  publishedAt: string | null;
  active: boolean;
  assets: LearningAssetSummary[];
  enrollmentCount: number;
  completedCount: number;
  createdAt: string;
};

export type LearningEnrollmentSummary = {
  id: string;
  clinicId: string | null;
  contentId: string;
  contentCode: string;
  contentTitle: string;
  contentType: LearningContentSummary["type"];
  userId: string;
  userName: string;
  assignedByName: string | null;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "EXPIRED";
  assignedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  score: number | null;
};

export type LearningWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  canSelfUpdate: boolean;
  message: string | null;
  clinics: LearningClinicOption[];
  users: LearningUserOption[];
  contents: LearningContentSummary[];
  enrollments: LearningEnrollmentSummary[];
};

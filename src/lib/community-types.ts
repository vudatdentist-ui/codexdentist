import type { CommunityPost } from "@/lib/data";

export type CommunityClinicOption = {
  id: string;
  name: string;
  city: string;
};

export type CommunityCommentSummary = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type CommunityPostSummary = CommunityPost & {
  comments: CommunityCommentSummary[];
};

export type CommunityWorkspace = {
  source: "database" | "demo";
  canMutate: boolean;
  message: string | null;
  clinics: CommunityClinicOption[];
  posts: CommunityPostSummary[];
};

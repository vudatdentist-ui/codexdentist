export type ModuleAiRunSummary = {
  id: string;
  action: string;
  status: string;
  model: string;
  createdAt: string;
  completedAt: string | null;
  output: unknown;
  rawOutput: string | null;
  error: string | null;
  totalTokens: number | null;
};

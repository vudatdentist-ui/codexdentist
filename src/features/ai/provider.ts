export type AiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiJsonResult = {
  baseUrl: string;
  content: string;
  model: string;
  output: unknown;
  provider: string;
  usage: {
    completionTokens: number | null;
    promptTokens: number | null;
    totalTokens: number | null;
  };
};

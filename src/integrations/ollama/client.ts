import "server-only";
import { readAiProviderJson } from "@/integrations/ai-http";
import type { AiChatMessage } from "@/features/ai/provider";

export async function generateLocalAiJson(config: { baseUrl: string; model: string }, messages: AiChatMessage[], signal: AbortSignal, schema?: Record<string, unknown>) {
  if (!messages.length || messages.length > 16 || messages.some(message =>
      !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string") ||
      Buffer.byteLength(JSON.stringify(messages), "utf8") > 24000) {
    throw new Error("Local AI context exceeds the supported size. Select fewer records.");
  }
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: "POST", redirect: "error", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, messages, stream: false, think: false, format: schema ?? "json",
      keep_alive: "2m", options: { temperature: 0.2, num_ctx: 8192, num_predict: 1024, num_thread: 3 } }),
  });
  const body = await readAiProviderJson(response) as {
    model?: string; done?: boolean; done_reason?: string; message?: { content?: unknown };
    prompt_eval_count?: number; eval_count?: number;
  } | null;
  if (!body || body.done !== true || body.done_reason !== "stop" || body.model !== config.model ||
      typeof body.message?.content !== "string" || !body.message.content.trim()) {
    throw new Error("Local AI did not complete a valid response. Retry with a smaller task.");
  }
  const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const promptTokens = tokens(body.prompt_eval_count), completionTokens = tokens(body.eval_count);
  return { content: body.message.content.trim(), usage: { promptTokens, completionTokens,
    totalTokens: promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null } };
}

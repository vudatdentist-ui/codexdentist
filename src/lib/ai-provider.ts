import "server-only";

import { codexMedAiConfig } from "@/lib/env";
import { readAiProviderJson } from "@/integrations/ai-http";
import { generateLocalAiJson } from "@/integrations/ollama/client";
import type { AiChatMessage, AiJsonResult } from "@/features/ai/provider";
export type { AiChatMessage, AiJsonResult } from "@/features/ai/provider";

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string; type?: string }>;
    };
  }>;
  usage?: {
    completion_tokens?: number;
    prompt_tokens?: number;
    total_tokens?: number;
  };
};

export function aiEnabled() {
  return codexMedAiConfig().enabled;
}
export function aiRuntimeIdentity() {
  const { provider, model } = codexMedAiConfig();
  return { provider, model };
}

export async function generateAiJson(messages: AiChatMessage[], options?: { schema: Record<string, unknown> }): Promise<AiJsonResult> {
  const config = codexMedAiConfig();

  if (!config.enabled) {
    throw new Error("CodexMed AI is disabled.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.provider === "ollama" ? 90_000 : 60_000);

  try {
    if (config.provider === "ollama") {
      const result = await generateLocalAiJson(config, messages, controller.signal, options?.schema);
      return { ...result, baseUrl: config.baseUrl, model: config.model, provider: config.provider,
        output: parseJsonFromModelContent(result.content) };
    }
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Authorization": `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages,
      }),
      signal: controller.signal,
    });

    const body = await readAiProviderJson(response) as ChatCompletionResponse;
    const content = normalizeAssistantContent(body.choices?.[0]?.message?.content);

    if (!content) {
      throw new Error("AI provider returned an empty response.");
    }

    return {
      baseUrl: config.baseUrl,
      content,
      model: config.model,
      output: parseJsonFromModelContent(content),
      provider: config.provider,
      usage: {
        completionTokens: body.usage?.completion_tokens ?? null,
        promptTokens: body.usage?.prompt_tokens ?? null,
        totalTokens: body.usage?.total_tokens ?? null,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeAssistantContent(
  content: string | Array<{ text?: string; type?: string }> | undefined,
) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => ("text" in part ? part.text ?? "" : ""))
      .join("")
      .trim();
  }

  return "";
}

function parseJsonFromModelContent(content: string) {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();

    if (fenced) {
      return JSON.parse(fenced);
    }

    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("AI provider did not return valid JSON.");
  }
}

import "server-only";

import { codexMedAiConfig } from "@/lib/env";

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

export async function generateAiJson(messages: AiChatMessage[]): Promise<AiJsonResult> {
  const config = codexMedAiConfig();

  if (!config.enabled) {
    throw new Error("CodexMed AI is disabled.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
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

    const bodyText = await response.text();
    const contentType = response.headers.get("content-type") ?? "";

    if (!response.ok) {
      if (contentType.includes("text/html") || bodyText.trimStart().startsWith("<!DOCTYPE html")) {
        throw new Error(
          `AI provider returned HTTP ${response.status} with an HTML page. Check CODEXMED_AI_BASE_URL; current endpoint is ${config.baseUrl}/chat/completions.`,
        );
      }

      if (!bodyText.trim()) {
        throw new Error(
          `AI provider returned HTTP ${response.status} with an empty response body. The provider may have rejected the request or failed internally.`,
        );
      }

      throw new Error(`AI provider returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }

    const body = JSON.parse(bodyText) as ChatCompletionResponse;
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

"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { databaseActorId, requiredString } from "@/lib/form-validation";
import { aiEnabled, generateAiJson } from "@/lib/ai-provider";
import { canAccessView, viewRoutes, type ViewKey } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import {
  consumeAiOrganizationAttempt,
  consumeAiUserAttempt,
} from "@/lib/rate-limit";

const supportedViews: ViewKey[] = [
  "dashboard",
  "accounting",
  "schedule",
  "patients",
  "journey",
  "clinical",
  "treatment",
  "billing",
  "services",
  "staff",
  "crm",
  "inventory",
  "pharmacy",
  "forms",
  "learning",
  "employee-app",
  "reports",
  "community",
  "patient-app",
  "settings",
];

export async function chatModuleWithAiAction(formData: FormData) {
  const module = normalizeView(formData.get("module"));
  const task = requiredString(formData.get("task"));
  const contextJson = requiredString(formData.get("contextJson"));
  const selectedPatientId = String(formData.get("selectedPatientId") ?? "").trim();
  const selectedPatientName = String(formData.get("selectedPatientName") ?? "").trim();

  if (!module || !task || task.length > 1200 || !contextJson || contextJson.length > 120000) {
    redirect("/dashboard?notice=module-ai-missing");
  }

  const session = await requireViewSession(module);

  if (!canAccessView(session, module)) {
    redirect(`${viewRoutes[module]}?notice=module-ai-denied`);
  }

  let context: unknown;

  try {
    context = JSON.parse(contextJson);
  } catch {
    redirect(`${viewRoutes[module]}?notice=module-ai-missing`);
  }

  if (isJourneyModule(module) && selectedPatientId) {
    context = scopeJourneyContextToPatient(context, selectedPatientId, selectedPatientName);
  }

  const input = {
    module,
    userRole: session.role,
    actor: session.fullName,
    selectedPatientId: selectedPatientId || null,
    selectedPatientName: selectedPatientName || null,
    task,
    context,
  };
  const limits = await Promise.all([
    consumeAiUserAttempt(session.userId),
    consumeAiOrganizationAttempt(session.organizationId),
  ]);

  if (limits.some((limit) => !limit.allowed)) {
    await createFailedModuleAiRun({
      session,
      input,
      module,
      error: "AI usage limit reached. Try again later.",
      model: "rate-limited",
    });
    revalidatePath(viewRoutes[module]);
    redirect(`${viewRoutes[module]}?notice=module-ai-failed`);
  }

  if (!aiEnabled()) {
    await createFailedModuleAiRun({
      session,
      input,
      module,
      error: "CodexMed AI is not enabled.",
      model: "disabled",
    });

    revalidatePath(viewRoutes[module]);
    redirect(`${viewRoutes[module]}?notice=module-ai-disabled`);
  }

  try {
    const result = await generateAiJson([
      {
        role: "system",
        content: [
      "You are CodexMed AI inside Codexdentist, a Vietnamese dental clinic operating system.",
          "Answer the user's module-specific operations task using only the provided module context.",
          "Do not invent data. If the context is insufficient, say exactly what is missing.",
          "For clinical, journey, pharmacy, and patient-related modules: do not diagnose, prescribe, or replace clinician judgement. Summarize records, flag missing information, and suggest operational next steps only.",
          "For finance, billing, accounting, reports: provide management analysis only, not tax/legal advice.",
          "Return valid JSON only with this shape:",
          '{"answer":"...","takeaways":["..."],"suggestedActions":["..."],"caveats":["..."]}',
          "Write all user-facing text in Vietnamese.",
        ].join("\n"),
      },
      {
        role: "user",
        content: JSON.stringify(input),
      },
    ]);

    await prisma.aiRun.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        module,
        action: "MODULE_TASK_CHAT",
        provider: result.provider,
        model: result.model,
        baseUrl: result.baseUrl,
        status: "SUCCEEDED",
        input: input as Prisma.InputJsonValue,
        output: result.output as Prisma.InputJsonValue,
        rawOutput: result.content.slice(0, 20000),
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await createFailedModuleAiRun({
      session,
      input,
      module,
      error: error instanceof Error ? error.message : "Unknown AI error",
    });

    redirect(`${viewRoutes[module]}?notice=module-ai-failed`);
  }

  revalidatePath(viewRoutes[module]);
  redirect(`${viewRoutes[module]}?notice=module-ai-ready`);
}

async function createFailedModuleAiRun({
  error,
  input,
  model = "unknown",
  module,
  session,
}: {
  error: string;
  input: Record<string, unknown>;
  model?: string;
  module: ViewKey;
  session: Awaited<ReturnType<typeof requireViewSession>>;
}) {
  await prisma.aiRun.create({
    data: {
      organizationId: session.organizationId,
      actorId: databaseActorId(session.userId),
      module,
      action: "MODULE_TASK_CHAT",
      provider: "openai-compatible",
      model,
      status: "FAILED",
      input: input as Prisma.InputJsonValue,
      error: error.slice(0, 2000),
      completedAt: new Date(),
    },
  });
}

function normalizeView(value: FormDataEntryValue | null): ViewKey | null {
  const view = String(value ?? "") as ViewKey;

  return supportedViews.includes(view) ? view : null;
}

function isJourneyModule(module: ViewKey) {
  return module === "journey" || module === "clinical" || module === "treatment";
}

function scopeJourneyContextToPatient(
  context: unknown,
  patientId: string,
  patientName: string,
) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return context;
  }

  const root = { ...(context as Record<string, unknown>) };
  const workspace = root.workspace;

  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    return {
      ...root,
      selectedPatientId: patientId,
      selectedPatientName: patientName || null,
    };
  }

  const scopedWorkspace: Record<string, unknown> = {
    ...(workspace as Record<string, unknown>),
    selectedPatientId: patientId,
    selectedPatientName: patientName || null,
  };

  for (const [key, value] of Object.entries(scopedWorkspace)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    scopedWorkspace[key] = scopeWorkspaceObjectToPatient(
      value as Record<string, unknown>,
      patientId,
      patientName,
    );
  }

  return {
    ...root,
    selectedPatientId: patientId,
    selectedPatientName: patientName || null,
    workspace: scopedWorkspace,
  };
}

function scopeWorkspaceObjectToPatient(
  workspace: Record<string, unknown>,
  patientId: string,
  patientName: string,
) {
  const scoped = { ...workspace };

  for (const [key, value] of Object.entries(scoped)) {
    if (Array.isArray(value)) {
      scoped[key] = scopeArrayToPatient(key, value, patientId, patientName);
      continue;
    }

    if (isCompactedArray(value)) {
      const sample = Array.isArray(value.sample)
        ? scopeArrayToPatient(key, value.sample, patientId, patientName)
        : [];

      scoped[key] = {
        ...value,
        count: sample.length,
        sample,
      };
    }
  }

  return scoped;
}

function isCompactedArray(value: unknown): value is { count: unknown; sample: unknown } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "count" in value &&
      "sample" in value,
  );
}

function scopeArrayToPatient(
  key: string,
  rows: unknown[],
  patientId: string,
  patientName: string,
) {
  if (key === "patients") {
    return rows.filter((row) => rowMatchesPatient(row, patientId, patientName, true));
  }

  const patientScoped = rows.some((row) => rowHasPatientFields(row));

  return patientScoped
    ? rows.filter((row) => rowMatchesPatient(row, patientId, patientName, false))
    : rows;
}

function rowHasPatientFields(row: unknown) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return false;
  }

  return "patientId" in row || "patientName" in row || "patient" in row;
}

function rowMatchesPatient(
  row: unknown,
  patientId: string,
  patientName: string,
  idOnly: boolean,
) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return false;
  }

  const record = row as Record<string, unknown>;

  if (record.patientId === patientId || record.id === patientId) {
    return true;
  }

  return !idOnly && Boolean(patientName) && (
    record.patientName === patientName || record.patient === patientName
  );
}

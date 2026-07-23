"use server";

import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireViewSession } from "@/lib/auth";
import { hasAnyRole } from "@/lib/permissions";
import {
  databaseActorId,
  optionalString,
  parseDateInVietnam,
  parseMoney,
  requiredString,
} from "@/lib/form-validation";
import { ensureAccountingCategories, getAccountingWorkspace } from "@/lib/accounting";
import { aiEnabled, generateAiJson } from "@/lib/ai-provider";
import {
  isUploadedPatientFile,
  storeAccountingUpload,
} from "@/lib/patient-file-storage";
import type { AppRole } from "@/lib/permissions";
import { canUseAllClinics } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";

const mutableAccountingRoles: AppRole[] = ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"];
const accountingKinds = ["INCOME", "EXPENSE", "TRANSFER"] as const;
const maxAccountingAttachmentBytes = 15 * 1024 * 1024;

export async function createAccountingEntryAction(formData: FormData) {
  const session = await requireViewSession("accounting");

  if (!canWriteAccounting(session)) {
    redirect("/accounting?notice=accounting-denied");
  }

  await ensureAccountingCategories(session.organizationId);

  const clinicId = optionalString(formData.get("clinicId"));
  const categoryId = requiredString(formData.get("categoryId"));
  const kind = normalizeKind(formData.get("kind"));
  const amount = parseMoney(formData.get("amount"));
  const occurredAt = parseDateInVietnam(formData.get("occurredAt"));
  const vendor = optionalString(formData.get("vendor"));
  const description = requiredString(formData.get("description"));
  const paymentMethod = optionalString(formData.get("paymentMethod"));
  const reference = optionalString(formData.get("reference"));
  const attachment = formData.get("attachment");
  const hasAttachment = isUploadedPatientFile(attachment);

  if (!categoryId || !kind || amount === null || !description || occurredAt === "invalid" || !occurredAt) {
    redirect("/accounting?notice=accounting-missing");
  }

  if (hasAttachment && (!attachment.type.startsWith("image/") || attachment.type === "image/svg+xml")) {
    redirect("/accounting?notice=accounting-attachment-type");
  }

  if (hasAttachment && attachment.size > maxAccountingAttachmentBytes) {
    redirect("/accounting?notice=accounting-attachment-large");
  }

  if (clinicId && !allowedClinicIds(session).includes(clinicId)) {
    redirect("/accounting?notice=accounting-denied");
  }

  try {
    const category = await prisma.accountingCategory.findFirst({
      where: {
        id: categoryId,
        organizationId: session.organizationId,
        active: true,
      },
      select: {
        id: true,
        kind: true,
      },
    });

    if (!category) {
      redirect("/accounting?notice=accounting-missing");
    }

    if (category.kind !== kind) {
      redirect("/accounting?notice=accounting-kind-mismatch");
    }

    const entryId = randomUUID();
    const storedAttachment = hasAttachment
      ? await storeAccountingUpload({
          file: attachment,
          organizationId: session.organizationId,
          entryId,
        })
      : null;

    const entry = await prisma.accountingEntry.create({
      data: {
        id: entryId,
        organizationId: session.organizationId,
        clinicId,
        categoryId: category.id,
        kind,
        amount,
        occurredAt,
        vendor,
        description,
        paymentMethod,
        reference,
        attachmentFileName: storedAttachment?.fileName ?? null,
        attachmentMimeType: storedAttachment?.mimeType ?? null,
        attachmentSizeBytes: storedAttachment?.sizeBytes ?? null,
        attachmentStorageProvider: storedAttachment?.storageProvider ?? null,
        attachmentStorageKey: storedAttachment?.storageKey ?? null,
        attachmentThumbnailMimeType: storedAttachment?.thumbnail?.mimeType ?? null,
        attachmentThumbnailStorageKey: storedAttachment?.thumbnail?.storageKey ?? null,
        sourceType: "manual",
        createdById: session.userId,
      },
      select: {
        id: true,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "accounting.entry_created",
        entityType: "AccountingEntry",
        entityId: entry.id,
        metadata: {
          clinicId,
          categoryId,
          kind,
          amount,
          attachmentSizeBytes: storedAttachment?.sizeBytes ?? null,
          hasAttachment: Boolean(storedAttachment),
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/accounting?notice=accounting-database");
  }

  revalidatePath("/accounting");
  redirect("/accounting?notice=accounting-entry-created");
}

export async function updateAccountingBudgetTargetAction(formData: FormData) {
  const session = await requireViewSession("accounting");

  if (!canWriteAccounting(session)) {
    redirect("/accounting?notice=accounting-denied");
  }

  await ensureAccountingCategories(session.organizationId);

  const clinicId = optionalString(formData.get("clinicId"));
  const categoryId = requiredString(formData.get("categoryId"));
  const periodMonth = requiredString(formData.get("periodMonth"));
  const targetPercent = parsePercent(formData.get("targetPercent"));
  const warningPercent = parseOptionalPercent(formData.get("warningPercent"));

  if (!categoryId || !/^\d{4}-\d{2}$/.test(periodMonth) || targetPercent === null || warningPercent === false) {
    redirect("/accounting?notice=accounting-missing");
  }

  if (clinicId && !allowedClinicIds(session).includes(clinicId)) {
    redirect("/accounting?notice=accounting-denied");
  }

  try {
    const category = await prisma.accountingCategory.findFirst({
      where: {
        id: categoryId,
        organizationId: session.organizationId,
        active: true,
      },
      select: {
        id: true,
      },
    });

    if (!category) {
      redirect("/accounting?notice=accounting-missing");
    }

    const existing = await prisma.accountingBudgetTarget.findFirst({
      where: {
        organizationId: session.organizationId,
        clinicId,
        categoryId: category.id,
        periodMonth,
      },
      select: {
        id: true,
      },
    });

    const target = existing
      ? await prisma.accountingBudgetTarget.update({
          where: {
            id: existing.id,
          },
          data: {
            targetPercent,
            warningPercent,
          },
          select: {
            id: true,
          },
        })
      : await prisma.accountingBudgetTarget.create({
          data: {
            organizationId: session.organizationId,
            clinicId,
            categoryId: category.id,
            periodMonth,
            targetPercent,
            warningPercent,
          },
          select: {
            id: true,
          },
        });

    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        action: "accounting.budget_target_updated",
        entityType: "AccountingBudgetTarget",
        entityId: target.id,
        metadata: {
          clinicId,
          categoryId,
          periodMonth,
          targetPercent,
          warningPercent,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isNextRedirect(error)) {
      throw error;
    }

    redirect("/accounting?notice=accounting-database");
  }

  revalidatePath("/accounting");
  redirect("/accounting?notice=accounting-budget-updated");
}

export async function analyzeAccountingWithAiAction(formData: FormData) {
  const session = await requireViewSession("accounting");

  if (!canWriteAccounting(session)) {
    redirect("/accounting?notice=accounting-denied");
  }

  const periodMonth = requiredString(formData.get("periodMonth"));

  if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
    redirect("/accounting?notice=accounting-missing");
  }

  if (!aiEnabled()) {
    redirect(`/accounting?month=${encodeURIComponent(periodMonth)}&notice=accounting-ai-disabled`);
  }

  const workspace = await getAccountingWorkspace(session, { periodMonth });
  const input = accountingAiInput(workspace);

  try {
    const result = await generateAiJson([
      {
        role: "system",
        content: [
          "You are CodexMed AI, a management accounting assistant for a Vietnamese dental clinic chain.",
          "Analyze operating P&L, budget percentages, and controllable clinic costs.",
          "Do not provide tax/legal accounting advice. Do not invent missing data.",
          "Return valid JSON only with this shape:",
          '{"summary":"...","alerts":[{"severity":"info|watch|critical","title":"...","detail":"...","metric":"..."}],"actions":[{"priority":"high|medium|low","title":"...","detail":"..."}],"questions":["..."],"caveats":["..."]}',
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
        module: "accounting",
        action: "PNL_ANALYSIS",
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
    await prisma.aiRun.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        module: "accounting",
        action: "PNL_ANALYSIS",
        provider: "openai-compatible",
        model: "unknown",
        status: "FAILED",
        input: input as Prisma.InputJsonValue,
        error: error instanceof Error ? error.message.slice(0, 2000) : "Unknown AI error",
        completedAt: new Date(),
      },
    });

    redirect(`/accounting?month=${encodeURIComponent(periodMonth)}&notice=accounting-ai-failed`);
  }

  revalidatePath("/accounting");
  redirect(`/accounting?month=${encodeURIComponent(periodMonth)}&notice=accounting-ai-ready`);
}

export async function chatAccountingWithAiAction(formData: FormData) {
  const session = await requireViewSession("accounting");

  if (!canWriteAccounting(session)) {
    redirect("/accounting?notice=accounting-denied");
  }

  const periodMonth = requiredString(formData.get("periodMonth"));
  const task = requiredString(formData.get("task"));

  if (!/^\d{4}-\d{2}$/.test(periodMonth) || !task || task.length > 1200) {
    redirect("/accounting?notice=accounting-missing");
  }

  if (!aiEnabled()) {
    redirect(`/accounting?month=${encodeURIComponent(periodMonth)}&notice=accounting-ai-disabled`);
  }

  const workspace = await getAccountingWorkspace(session, { periodMonth });
  const input = {
    ...accountingAiInput(workspace),
    userTask: task,
    instruction:
      "Answer the user's accounting operations question using only the provided accounting workspace data.",
  };

  try {
    const result = await generateAiJson([
      {
        role: "system",
        content: [
          "You are CodexMed AI, a task-focused management accounting assistant for a Vietnamese dental clinic chain.",
          "Use only the JSON workspace data provided by the app. If the data is insufficient, say what is missing.",
          "Do not provide tax/legal accounting advice. Do not invent transactions, vendors, or clinical facts.",
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
        module: "accounting",
        action: "TASK_CHAT",
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
    await prisma.aiRun.create({
      data: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        module: "accounting",
        action: "TASK_CHAT",
        provider: "openai-compatible",
        model: "unknown",
        status: "FAILED",
        input: input as Prisma.InputJsonValue,
        error: error instanceof Error ? error.message.slice(0, 2000) : "Unknown AI error",
        completedAt: new Date(),
      },
    });

    redirect(`/accounting?month=${encodeURIComponent(periodMonth)}&notice=accounting-ai-chat-failed`);
  }

  revalidatePath("/accounting");
  redirect(`/accounting?month=${encodeURIComponent(periodMonth)}&notice=accounting-ai-chat-ready`);
}

function normalizeKind(value: FormDataEntryValue | null) {
  const kind = String(value ?? "").toUpperCase();

  return accountingKinds.find((candidate) => candidate === kind) ?? null;
}

function parsePercent(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").replace(",", "."));

  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function parseOptionalPercent(value: FormDataEntryValue | null) {
  if (!String(value ?? "").trim()) {
    return null;
  }

  return parsePercent(value) ?? false;
}

function allowedClinicIds(session: AppSession) {
  if (canUseAllClinics(session)) {
    return session.clinicIds;
  }

  return session.activeClinicId ? [session.activeClinicId] : session.clinicIds;
}

function canWriteAccounting(session: AppSession) {
  return hasAnyRole(session, mutableAccountingRoles);
}

function accountingAiInput(workspace: Awaited<ReturnType<typeof getAccountingWorkspace>>) {
  return {
    module: "accounting",
    periodMonth: workspace.periodMonth,
    generatedAt: workspace.generatedAt,
    summary: workspace.summary,
    pnlLines: workspace.pnlLines.map((line) => ({
      categoryCode: line.categoryCode,
      categoryName: line.categoryName,
      kind: line.kind,
      amount: line.amount,
      percentOfCollections: line.percentOfCollections,
      targetPercent: line.targetPercent,
      warningPercent: line.warningPercent,
      status: line.status,
    })),
    manualEntries: workspace.entries
      .filter((entry) => entry.sourceType === "manual")
      .slice(0, 80)
      .map((entry) => ({
        occurredAt: entry.occurredAt,
        clinicName: entry.clinicName,
        categoryCode: entry.categoryCode,
        categoryName: entry.categoryName,
        kind: entry.kind,
        amount: entry.amount,
        vendor: entry.vendor,
        description: entry.description,
        paymentMethod: entry.paymentMethod,
      })),
    sampledEntries: workspace.entries
      .slice(0, 120)
      .map((entry) => ({
        occurredAt: entry.occurredAt,
        clinicName: entry.clinicName,
        categoryCode: entry.categoryCode,
        categoryName: entry.categoryName,
        kind: entry.kind,
        amount: entry.amount,
        vendor: entry.vendor,
        description: entry.description,
        paymentMethod: entry.paymentMethod,
        sourceType: entry.sourceType,
      })),
    derivedSourceCounts: workspace.entries.reduce<Record<string, number>>((counts, entry) => {
      counts[entry.sourceType] = (counts[entry.sourceType] ?? 0) + 1;

      return counts;
    }, {}),
    largestEntries: workspace.entries
      .filter((entry) => entry.kind === "EXPENSE")
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 25)
      .map((entry) => ({
        occurredAt: entry.occurredAt,
        clinicName: entry.clinicName,
        categoryCode: entry.categoryCode,
        categoryName: entry.categoryName,
        amount: entry.amount,
        vendor: entry.vendor,
        description: entry.description,
        sourceType: entry.sourceType,
      })),
  };
}

function isNextRedirect(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}

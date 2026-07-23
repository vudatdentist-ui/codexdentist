import "server-only";

import { prisma } from "@/lib/prisma";
import type { ModuleAiRunSummary } from "@/lib/ai-runs-types";
import type { AppSession } from "@/lib/session";
import type { ViewKey } from "@/lib/permissions";

export async function getModuleAiRuns(
  session: AppSession,
  module: ViewKey,
): Promise<ModuleAiRunSummary[]> {
  try {
    const runs = await prisma.aiRun.findMany({
      where: {
        organizationId: session.organizationId,
        actorId: databaseActorId(session.userId),
        module,
        action: "MODULE_TASK_CHAT",
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    });

    return runs.map((run) => ({
      id: run.id,
      action: run.action,
      status: run.status,
      model: run.model,
      createdAt: vietnamDateTime(run.createdAt),
      completedAt: run.completedAt ? vietnamDateTime(run.completedAt) : null,
      output: run.output,
      rawOutput: run.rawOutput,
      error: run.error,
      totalTokens: run.totalTokens,
    }));
  } catch {
    return [];
  }
}

function databaseActorId(userId: string) {
  return userId.startsWith("demo-") ? null : userId;
}

function vietnamDateTime(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

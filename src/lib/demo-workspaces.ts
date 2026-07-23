import "server-only";

import { randomBytes } from "node:crypto";
import {
  demoWorkspaceEnabled,
  demoWorkspaceLimit,
  demoWorkspaceTtlHours,
} from "@/lib/env";
import { createOrganizationWorkspace } from "@/lib/organization-onboarding";
import { purgeOrganization } from "@/lib/organization-purge";
import { prisma } from "@/lib/prisma";

export async function createDemoWorkspace() {
  if (!demoWorkspaceEnabled()) {
    throw new Error("Demo workspaces are disabled.");
  }

  await cleanupExpiredDemoWorkspaces({ limit: 3 });

  const activeCount = await prisma.organization.count({
    where: {
      isDemo: true,
      demoExpiresAt: {
        gt: new Date(),
      },
    },
  });

  if (activeCount >= demoWorkspaceLimit()) {
    throw new Error("Demo workspace capacity has been reached.");
  }

  const token = randomBytes(6).toString("hex");
  const slug = `demo-${token}`;
  const password = randomBytes(24).toString("base64url");
  const expiresAt = new Date(
    Date.now() + demoWorkspaceTtlHours() * 60 * 60 * 1000,
  );

  const workspace = await createOrganizationWorkspace({
    name: "Phòng khám Demo Codexdentist",
    slug,
    ownerEmail: `owner+${token}@demo.codexdentist.local`,
    ownerFullName: "Chủ phòng khám Demo",
    ownerPassword: password,
    clinicName: "Codexdentist Demo",
    city: "TP. Hồ Chí Minh",
    address: "Dữ liệu giả lập, không phải địa chỉ thật",
    isDemo: true,
    demoExpiresAt: expiresAt,
    seedDemoData: true,
  });

  return {
    ...workspace,
    password,
    expiresAt,
  };
}

export async function cleanupExpiredDemoWorkspaces(input?: { limit?: number }) {
  const expired = await prisma.organization.findMany({
    where: {
      isDemo: true,
      demoExpiresAt: {
        lte: new Date(),
      },
    },
    select: {
      id: true,
    },
    orderBy: {
      demoExpiresAt: "asc",
    },
    take: input?.limit ?? 20,
  });
  const deletedOrganizationIds: string[] = [];

  for (const organization of expired) {
    await purgeOrganization(organization.id);
    deletedOrganizationIds.push(organization.id);
  }

  return {
    deletedCount: deletedOrganizationIds.length,
    deletedOrganizationIds,
  };
}

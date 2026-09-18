import { NextResponse } from "next/server";
import { canPerformAction } from "@/lib/actions/permissions";
import { getSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { hasAnyRole } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { upsertIntegrationConnection } from "@/infrastructure/integrations/substrate";
import { hasSameOrigin } from "@/lib/request-security";
import { allowedClinicIds } from "@/lib/patient-access";

const providers = new Set(["payos", "documenso", "orthanc"]);
const secretRefPattern = /^env:[A-Z][A-Z0-9_]*$/;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  if (!canPerformAction(session, "settings.manage")) return error("forbidden", 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const provider = typeof body?.provider === "string" ? body.provider.trim().toLowerCase() : "";
  const requestedClinicId = typeof body?.clinicId === "string" && body.clinicId.trim()
    ? body.clinicId.trim()
    : null;
  const secretRef = typeof body?.secretRef === "string" ? body.secretRef.trim() : "";
  if (!providers.has(provider)) return error("integration-provider-invalid", 400);
  if (!secretRefPattern.test(secretRef)) return error("integration-secret-ref-invalid", 400);
  if (provider === "payos" && secretRef !== "env:PAYOS_DEFAULT") return error("payos-secret-ref-invalid", 400);
  if (provider === "documenso" && secretRef !== "env:DOCUMENSO_DEFAULT") return error("documenso-secret-ref-invalid", 400);
  if (provider === "orthanc" && secretRef !== "env:ORTHANC_DEFAULT") {
    return error("orthanc-secret-ref-invalid", 400);
  }
  if (requestedClinicId && !allowedClinicIds(session).includes(requestedClinicId)) {
    return error("integration-clinic-forbidden", 403);
  }

  const canConfigureOrganizationWide = hasAnyRole(session, ["OWNER", "AREA_MANAGER"]);
  const clinicId = requestedClinicId ??
    (canConfigureOrganizationWide ? null : session.activeClinicId);
  if (!canConfigureOrganizationWide && !clinicId) {
    return error("integration-clinic-required", 403);
  }

  let connection;
  try {
    connection = await upsertIntegrationConnection(prisma, {
    organizationId: session.organizationId,
    clinicId,
    provider,
    status: "ACTIVE",
    secretRef,
    capabilities:
      provider === "payos"
        ? { paymentLinks: true, webhooks: true }
        : provider === "documenso"
          ? { signing: true, webhooks: true }
          : { dicomStudies: true, ohifViewer: true, webhooks: false },
    metadata: {
      configuredByUserId: session.userId,
      secretStorage: "environment",
      scope: clinicId ? "clinic" : "organization",
    },
    });
    await prisma.auditLog.create({
    data: {
      organizationId: session.organizationId,
      actorId: session.userId,
      action: "integration.connection_configured",
      entityType: "IntegrationConnection",
      entityId: connection.id,
      metadata: { provider, clinicId, secretRef },
    },
    });
  } catch (cause) {
    console.error("integration.connection_configure_failed", cause);
    return error("integration-connection-failed", 503);
  }

  const webhookUrl = provider === "orthanc"
    ? null
    : `${appBaseUrl()}/api/integrations/${provider}/webhooks/${connection.id}`;
  return json({
    id: connection.id,
    provider,
    clinicId,
    webhookUrl,
  });
}

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "cache-control": "no-store", ...(init?.headers ?? {}) } });
}

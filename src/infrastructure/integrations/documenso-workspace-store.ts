import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { IntegrationConnectionRecord, ExternalReferenceRecord } from "./phase3-store";
import type { DocumensoConnectionSummary } from "@/features/integrations/documenso-workspace";

type DB = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe"> | Prisma.TransactionClient;

export async function documensoConnections(db: DB, organizationId: string, clinicIds: string[]) {
  return db.$queryRawUnsafe<IntegrationConnectionRecord[]>(
    `SELECT * FROM "IntegrationConnection" WHERE "organizationId"=$1 AND "provider"='documenso'
     AND ("clinicId" IS NULL OR "clinicId"=ANY($2::text[])) ORDER BY "createdAt"`, organizationId, clinicIds);
}

export function documensoConnectionSummary(connection: IntegrationConnectionRecord, origin: string): DocumensoConnectionSummary {
  const configured = connection.secretRef === "vault:v1" || (connection.secretRef === "env:DOCUMENSO_DEFAULT" &&
    process.env.DOCUMENSO_DEFAULT_ORGANIZATION_ID === connection.organizationId &&
    ["DOCUMENSO_DEFAULT_API_TOKEN", "DOCUMENSO_DEFAULT_WEBHOOK_SECRET"].every(key => Boolean(process.env[key]?.trim())));
  return { id: connection.id, clinicId: connection.clinicId, enabled: connection.status === "ACTIVE", configured,
    webhookUrl: `${origin}/api/integrations/documenso/webhooks/${encodeURIComponent(connection.id)}`,
    verifiedAt: connection.lastVerifiedAt?.toISOString() ?? null };
}

export async function hasActiveDocumensoRequests(db: DB, organizationId: string, connectionId: string) {
  const rows = await db.$queryRawUnsafe<Array<{ active: boolean }>>(
    `SELECT EXISTS(SELECT 1 FROM "ExternalReference" WHERE "organizationId"=$1 AND "connectionId"=$2
      AND "provider"='documenso' AND "entityType"='DOCUMENSO_REQUEST'
      AND COALESCE("metadata"->>'status','CREATING') NOT IN ('SIGNED','CANCELLED','REJECTED','FAILED')) AS active`, organizationId, connectionId);
  return rows[0]?.active ?? false;
}

export async function documensoFormRequests(db: DB, organizationId: string, patientFormId: string) {
  return db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `SELECT * FROM "ExternalReference" WHERE "organizationId"=$1 AND "provider"='documenso'
     AND "entityType"='DOCUMENSO_REQUEST' AND "internalId"=$2 ORDER BY "createdAt","id"`, organizationId, patientFormId);
}

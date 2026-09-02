import type { Prisma, PrismaClient } from "@prisma/client";

type SqlExecutor = Pick<
  PrismaClient,
  "$executeRawUnsafe" | "$queryRawUnsafe"
> | Prisma.TransactionClient;

export type IntegrationConnectionRecord = {
  id: string;
  organizationId: string;
  clinicId: string | null;
  provider: string;
  status: string;
  capabilities: unknown;
  secretRef: string | null;
  metadata: unknown;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ExternalReferenceRecord = {
  id: string;
  organizationId: string;
  clinicId: string | null;
  connectionId: string | null;
  provider: string;
  entityType: string;
  internalId: string;
  externalId: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export async function findActiveIntegrationConnection(
  db: SqlExecutor,
  input: {
    organizationId: string;
    clinicId: string;
    provider: string;
  },
) {
  const rows = await db.$queryRawUnsafe<IntegrationConnectionRecord[]>(
    `SELECT * FROM "IntegrationConnection"
     WHERE "organizationId" = $1
       AND "provider" = $2
       AND "status" = 'ACTIVE'
       AND ("clinicId" = $3 OR "clinicId" IS NULL)
     ORDER BY CASE WHEN "clinicId" = $3 THEN 0 ELSE 1 END, "createdAt"
     LIMIT 1`,
    input.organizationId,
    input.provider,
    input.clinicId,
  );
  return rows[0] ?? null;
}

export async function getIntegrationConnectionById(
  db: SqlExecutor,
  connectionId: string,
  provider?: string,
) {
  const rows = await db.$queryRawUnsafe<IntegrationConnectionRecord[]>(
    `SELECT * FROM "IntegrationConnection"
     WHERE "id" = $1
       AND ($2::text IS NULL OR "provider" = $2)
     LIMIT 1`,
    connectionId,
    provider ?? null,
  );
  return rows[0] ?? null;
}

export async function getExternalReferenceByExternalId(
  db: SqlExecutor,
  input: {
    organizationId: string;
    connectionId: string;
    provider: string;
    entityType: string;
    externalId: string;
  },
) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `SELECT * FROM "ExternalReference"
     WHERE "organizationId" = $1
       AND "connectionId" = $2
       AND "provider" = $3
       AND "entityType" = $4
       AND "externalId" = $5
     LIMIT 1`,
    input.organizationId,
    input.connectionId,
    input.provider,
    input.entityType,
    input.externalId,
  );
  return rows[0] ?? null;
}

export async function getExternalReferenceByInternalId(
  db: SqlExecutor,
  input: {
    organizationId: string;
    connectionId: string;
    provider: string;
    entityType: string;
    internalId: string;
  },
) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `SELECT * FROM "ExternalReference"
     WHERE "organizationId" = $1
       AND "connectionId" = $2
       AND "provider" = $3
       AND "entityType" = $4
       AND "internalId" = $5
     LIMIT 1`,
    input.organizationId,
    input.connectionId,
    input.provider,
    input.entityType,
    input.internalId,
  );
  return rows[0] ?? null;
}

export async function lockExternalReferenceByExternalId(
  db: Prisma.TransactionClient,
  input: {
    organizationId: string;
    connectionId: string;
    provider: string;
    entityType: string;
    externalId: string;
  },
) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `SELECT * FROM "ExternalReference"
     WHERE "organizationId" = $1
       AND "connectionId" = $2
       AND "provider" = $3
       AND "entityType" = $4
       AND "externalId" = $5
     FOR UPDATE`,
    input.organizationId,
    input.connectionId,
    input.provider,
    input.entityType,
    input.externalId,
  );
  return rows[0] ?? null;
}

export async function updateExternalReferenceMetadata(
  db: SqlExecutor,
  referenceId: string,
  metadata: Record<string, unknown>,
) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `UPDATE "ExternalReference"
     SET "metadata" = $2::jsonb,
         "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1
     RETURNING *`,
    referenceId,
    JSON.stringify(metadata),
  );
  if (!rows[0]) throw new Error("integration-external-reference-not-found");
  return rows[0];
}

export function referenceMetadata(
  reference: Pick<ExternalReferenceRecord, "metadata"> | null,
): Record<string, unknown> {
  return reference?.metadata &&
    typeof reference.metadata === "object" &&
    !Array.isArray(reference.metadata)
    ? (reference.metadata as Record<string, unknown>)
    : {};
}

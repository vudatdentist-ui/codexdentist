import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { IntegrationConnectionRecord, ExternalReferenceRecord } from "./phase3-store";
import { referenceMetadata } from "./phase3-store";
import { payOSCheckoutUrl, type PayOSConnectionSummary, type PayOSOrderSummary } from "@/features/integrations/payos-workspace";

type DB = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe"> | Prisma.TransactionClient;
export async function payOSConnections(db: DB, organizationId: string, clinicIds: string[]) {
  return db.$queryRawUnsafe<IntegrationConnectionRecord[]>(
    `SELECT * FROM "IntegrationConnection" WHERE "organizationId"=$1 AND "provider"='payos'
     AND ("clinicId" IS NULL OR "clinicId"=ANY($2::text[])) ORDER BY "createdAt"`, organizationId, clinicIds);
}
export function payOSConnectionSummary(connection: IntegrationConnectionRecord, origin: string): PayOSConnectionSummary {
  const metadata = referenceMetadata(connection);
  const stored = connection.secretRef === "vault:v1";
  const configured = stored || (connection.secretRef === "env:PAYOS_DEFAULT" &&
    process.env.PAYOS_DEFAULT_ORGANIZATION_ID === connection.organizationId &&
    ["PAYOS_DEFAULT_CLIENT_ID", "PAYOS_DEFAULT_API_KEY", "PAYOS_DEFAULT_CHECKSUM_KEY"].every(key => Boolean(process.env[key]?.trim())));
  const confirmedProbe = metadata.webhookConfirmed === true && typeof metadata.verificationId === "string"
    ? `?verification=${encodeURIComponent(metadata.verificationId)}` : "";
  return { id: connection.id, clinicId: connection.clinicId, enabled: connection.status === "ACTIVE", configured,
    verified: configured && Boolean(connection.lastVerifiedAt) && (!stored || metadata.webhookConfirmed === true),
    webhookUrl: `${origin}/api/integrations/payos/webhooks/${encodeURIComponent(connection.id)}${confirmedProbe}`,
    verifiedAt: connection.lastVerifiedAt?.toISOString() ?? null };
}
export async function payOSOrders(db: DB, input: { organizationId: string; clinicId: string; patientId: string; invoiceNo: string }) {
  const rows = await db.$queryRawUnsafe<ExternalReferenceRecord[]>(
    `SELECT * FROM "ExternalReference" WHERE "organizationId"=$1 AND "clinicId"=$2 AND "provider"='payos'
     AND "entityType"='PAYOS_ORDER' AND "metadata"->>'patientId'=$3 AND "metadata"->>'invoiceNo'=$4
     ORDER BY "createdAt" DESC LIMIT 50`, input.organizationId, input.clinicId, input.patientId, input.invoiceNo);
  return rows.map((row): PayOSOrderSummary => {
    const metadata = referenceMetadata(row);
    return { id: row.id, orderCode: Number(row.externalId), amount: Number(metadata.amount), invoiceNo: input.invoiceNo,
      status: typeof metadata.status === "string" ? metadata.status : "PENDING", checkoutUrl: payOSCheckoutUrl(metadata.checkoutUrl),
      qrCode: typeof metadata.qrCode === "string" && metadata.qrCode.length <= 4096 ? metadata.qrCode : null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      receiptNo: typeof metadata.receiptNo === "string" ? metadata.receiptNo : null };
  });
}
export async function hasUnresolvedPayOSOrders(db: DB, connectionId: string, organizationId: string) {
  const rows = await db.$queryRawUnsafe<Array<{ unresolved: boolean }>>(
    `SELECT EXISTS(SELECT 1 FROM "ExternalReference" WHERE "connectionId"=$1 AND "organizationId"=$2
       AND "provider"='payos' AND "entityType"='PAYOS_ORDER'
       AND COALESCE("metadata"->>'status','PENDING') NOT IN ('SETTLED','CANCELLED','FAILED')) AS unresolved`, connectionId, organizationId);
  return rows[0]?.unresolved ?? false;
}

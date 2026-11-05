import "server-only";
import { prisma } from "@/lib/prisma";
import { readIntegrationSecrets } from "@/infrastructure/integrations/credential-vault";
import type { IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { IntegrationConfigurationError, resolvePayOSConnectionSecrets, payOSBaseUrl } from "@/integrations/config";
import type { PayOSSecrets } from "@/integrations/payos/client";
import type { Prisma } from "@prisma/client";

export async function payOSConnectionSecrets(connection: IntegrationConnectionRecord, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<PayOSSecrets> {
  if (connection.provider !== "payos") throw new IntegrationConfigurationError("payos-connection-not-configured", "Invalid connection");
  if (connection.secretRef === "vault:v1") {
    const secrets = await readIntegrationSecrets(db, {
      organizationId: connection.organizationId, connectionId: connection.id, provider: "payos",
    });
    if (!secrets?.clientId || !secrets.apiKey || !secrets.checksumKey) {
      throw new IntegrationConfigurationError("payos-credential-missing", "Connection credentials are unavailable");
    }
    return { clientId: secrets.clientId, apiKey: secrets.apiKey, checksumKey: secrets.checksumKey, baseUrl: payOSBaseUrl() };
  }
  // An environment merchant must never be claimed by another hosted tenant.
  if (process.env.PAYOS_DEFAULT_ORGANIZATION_ID !== connection.organizationId) {
    throw new IntegrationConfigurationError("payos-connection-not-configured", "Merchant scope is not configured");
  }
  return resolvePayOSConnectionSecrets(connection.secretRef);
}

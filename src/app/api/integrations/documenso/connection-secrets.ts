import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readIntegrationSecrets } from "@/infrastructure/integrations/credential-vault";
import type { IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { IntegrationConfigurationError, resolveDocumensoConnectionSecrets, documensoBaseUrl } from "@/integrations/config";
import type { DocumensoSecrets } from "@/integrations/documenso/client";

export async function documensoConnectionSecrets(connection: IntegrationConnectionRecord,
  db: Prisma.TransactionClient | typeof prisma = prisma): Promise<DocumensoSecrets> {
  if (connection.provider !== "documenso") throw new IntegrationConfigurationError("documenso-connection-not-configured", "Invalid connection");
  if (connection.secretRef === "vault:v1") {
    const secrets = await readIntegrationSecrets(db, { organizationId: connection.organizationId, connectionId: connection.id, provider: "documenso" });
    if (!secrets?.apiToken || !secrets.webhookSecret) throw new IntegrationConfigurationError("documenso-credential-missing", "Connection credentials are unavailable");
    return { apiToken: secrets.apiToken, webhookSecret: secrets.webhookSecret, baseUrl: documensoBaseUrl(),
      sendOwnerEmails: process.env.DOCUMENSO_SEND_OWNER_EMAILS !== "false",
      automaticReminders: process.env.DOCUMENSO_AUTOMATIC_REMINDERS !== "false" };
  }
  if (process.env.DOCUMENSO_DEFAULT_ORGANIZATION_ID !== connection.organizationId) {
    throw new IntegrationConfigurationError("documenso-connection-not-configured", "Signing account scope is not configured");
  }
  return { ...resolveDocumensoConnectionSecrets(connection.secretRef),
    sendOwnerEmails: process.env.DOCUMENSO_SEND_OWNER_EMAILS !== "false",
    automaticReminders: process.env.DOCUMENSO_AUTOMATIC_REMINDERS !== "false" };
}

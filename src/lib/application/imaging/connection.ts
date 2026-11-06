import "server-only";

import type { IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { resolveOrthancConnectionSecrets } from "@/integrations/config";
import type { OrthancConnectionSecrets } from "@/integrations/orthanc/client";
import { orthancVaultSecrets } from "@/integrations/orthanc/connection";
import { ApplicationCommandError } from "@/lib/application/errors";
import type { AppSession } from "@/lib/session";

/** Resolve the stored study's connection, never a browser-selected provider URL. */
export async function resolveImagingConnection(
  session: AppSession,
  connection: IntegrationConnectionRecord,
  clinicId: string,
): Promise<OrthancConnectionSecrets> {
  if (session.isDemo) throw new ApplicationCommandError("imaging-demo-unavailable");
  if (connection.provider !== "orthanc" || connection.status !== "ACTIVE" ||
      connection.organizationId !== session.organizationId ||
      (connection.clinicId !== null && connection.clinicId !== clinicId)) {
    throw new ApplicationCommandError("imaging-connection-unavailable");
  }
  // Retain the exact legacy env prefix and organization binding validation.
  if (connection.secretRef?.startsWith("env:")) return resolveOrthancConnectionSecrets(connection);
  const { loadOptionalProviderConnection } = await import("@/lib/application/integrations/optional-provider-settings");
  const loaded = await loadOptionalProviderConnection(session, "orthanc", clinicId);
  if (loaded.connection.id !== connection.id) throw new ApplicationCommandError("imaging-connection-unavailable");
  return orthancVaultSecrets(loaded.secrets);
}

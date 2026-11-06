import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { canPerformAction } from "@/lib/actions/permissions";
import { hasAnyRole } from "@/lib/permissions";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { runSerializableTransaction } from "@/lib/transaction";
import { readIntegrationSecrets, writeIntegrationSecrets } from "@/infrastructure/integrations/credential-vault";
import { upsertIntegrationConnection } from "@/infrastructure/integrations/substrate";
import { findActiveIntegrationConnection, referenceMetadata, type IntegrationConnectionRecord } from "@/infrastructure/integrations/phase3-store";
import { optionalProviderBaseUrl } from "@/integrations/optional-http";
import type { OptionalProvider, OptionalProviderDefinition, OptionalProviderWorkspace } from "@/features/integrations/optional-provider";

type DB = Prisma.TransactionClient | typeof prisma;
export type OptionalProviderVerifier = (secrets: Record<string, string>) => Promise<{ identity: string }>;
export function optionalProviderFail(code: string, status = 400): never { throw Object.assign(new Error(code), { code, status }); }
function manage(session: AppSession, clinicId?: unknown, mutate = false) {
  if (!canPerformAction(session, "settings.manage")) optionalProviderFail("forbidden", 403);
  if (mutate && session.isDemo) optionalProviderFail("integration-demo-unavailable", 403);
  if (clinicId === undefined) return;
  if (clinicId === null && hasAnyRole({ ...session, activeClinicId: null }, ["OWNER", "AREA_MANAGER"])) return;
  if (typeof clinicId !== "string" || !accessibleClinicIds(session).includes(clinicId) ||
      !canPerformAction({ ...session, activeClinicId: clinicId }, "settings.manage")) optionalProviderFail("integration-clinic-forbidden", 403);
}
async function connectionAt(db: DB, org: string, provider: OptionalProvider, clinicId: string | null, lock = false) {
  const rows = await db.$queryRawUnsafe<IntegrationConnectionRecord[]>(`SELECT * FROM "IntegrationConnection"
    WHERE "organizationId"=$1 AND "provider"=$2 AND "clinicId" IS NOT DISTINCT FROM $3::text ${lock ? "FOR UPDATE" : ""}`, org, provider, clinicId);
  return rows[0] ?? null;
}
async function hasReferences(db: DB, connection: IntegrationConnectionRecord) {
  const rows = await db.$queryRawUnsafe<Array<{ linked: boolean }>>(`SELECT EXISTS(SELECT 1 FROM "ExternalReference"
    WHERE "organizationId"=$1 AND "connectionId"=$2 AND "provider"=$3 AND "entityType"<>'PROVIDER_ACCOUNT') AS linked`, connection.organizationId, connection.id, connection.provider);
  return rows[0]?.linked === true;
}
function isVerified(connection: IntegrationConnectionRecord) {
  const metadata = referenceMetadata(connection);
  return connection.secretRef === "vault:v1" && Boolean(connection.lastVerifiedAt) && typeof metadata.configurationVersion === "string" &&
    metadata.verifiedVersion === metadata.configurationVersion && typeof metadata.providerIdentity === "string" && Boolean(metadata.providerIdentity);
}
export { isVerified as optionalConnectionIsVerified };
export async function getOptionalProviderSettings(session: AppSession, definition: OptionalProviderDefinition): Promise<OptionalProviderWorkspace> {
  manage(session);
  const clinics = session.clinics.filter(clinic => accessibleClinicIds(session).includes(clinic.id) &&
    canPerformAction({ ...session, activeClinicId: clinic.id }, "settings.manage")).map(({ id, name }) => ({ id, name }));
  const rows = await prisma.$queryRawUnsafe<IntegrationConnectionRecord[]>(`SELECT * FROM "IntegrationConnection"
    WHERE "organizationId"=$1 AND "provider"=$2 AND ("clinicId" IS NULL OR "clinicId"=ANY($3::text[])) ORDER BY "createdAt"`,
    session.organizationId, definition.provider, clinics.map(clinic => clinic.id));
  return { definition, clinics, canManageOrganization: hasAnyRole(session, ["OWNER", "AREA_MANAGER"]), isDemo: session.isDemo,
    connections: await Promise.all(rows.map(async row => ({ id: row.id, clinicId: row.clinicId, status: row.status,
      configured: row.secretRef === "vault:v1", verified: isVerified(row), verifiedAt: isVerified(row) ? row.lastVerifiedAt!.toISOString() : null,
      hasReferences: await hasReferences(prisma, row) }))) };
}
function credentialsFor(definition: OptionalProviderDefinition, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) optionalProviderFail("integration-input-invalid");
  const entries = value as Record<string, unknown>, secrets: Record<string, string> = {};
  if (Object.keys(entries).some(key => !definition.fields.some(field => field.key === key))) optionalProviderFail("integration-input-invalid");
  for (const field of definition.fields) {
    const input = entries[field.key] ?? field.defaultValue;
    if ((input === undefined || input === "") && !field.required) { secrets[field.key] = ""; continue; }
    if (typeof input !== "string" || !input.trim() || input.length > 4096 || /[\u0000-\u001f\u007f]/.test(input)) optionalProviderFail("integration-credential-invalid");
    secrets[field.key] = field.secret ? input : input.trim();
  }
  secrets.baseUrl = optionalProviderBaseUrl(secrets.baseUrl!);
  return secrets;
}
export async function configureOptionalProvider(session: AppSession, definition: OptionalProviderDefinition,
  body: Record<string, unknown>, verify: OptionalProviderVerifier) {
  manage(session, body.clinicId, true);
  if (body.clinicId !== null && typeof body.clinicId !== "string") optionalProviderFail("integration-clinic-forbidden", 403);
  const clinicId = body.clinicId as string | null;
  const action = String(body.action);
  if (!["save", "disable", "verify", "rotate"].includes(action)) optionalProviderFail("integration-input-invalid");
  const submitted = ["save", "rotate"].includes(action) ? credentialsFor(definition, body.credentials) : null;
  const captured = await runSerializableTransaction(async tx => {
    const current = await connectionAt(tx, session.organizationId, definition.provider, clinicId, true);
    if (!current && action !== "save") optionalProviderFail("integration-connection-not-configured", 409);
    if (current && action === "save" && await hasReferences(tx, current)) optionalProviderFail("integration-use-credential-rotation", 409);
    const metadata = current ? referenceMetadata(current) : {};
    if (action === "verify" || action === "rotate") {
      if (current!.secretRef !== "vault:v1") optionalProviderFail("integration-use-provider-settings", 409);
      const oldSecrets = await readIntegrationSecrets(tx, { organizationId: session.organizationId, connectionId: current!.id, provider: definition.provider });
      if (!oldSecrets) optionalProviderFail("integration-credentials-missing", 409);
      if (action === "rotate" && (!isVerified(current!) || definition.fields.some(field => !field.secret && submitted![field.key] !== oldSecrets[field.key]))) {
        optionalProviderFail("integration-account-binding-mismatch", 409);
      }
      return { current: current!, metadata, secrets: submitted ?? oldSecrets };
    }
    const saved = await upsertIntegrationConnection(tx, { organizationId: session.organizationId, clinicId, provider: definition.provider,
      status: "DISABLED", ...(submitted ? { secretRef: "vault:v1", lastVerifiedAt: null,
        metadata: { configurationVersion: randomUUID(), configuredByUserId: session.userId } } : {
        lastVerifiedAt: null, metadata: { ...metadata, configurationVersion: randomUUID(), verifiedVersion: null } }) });
    if (submitted) await writeIntegrationSecrets(tx, { organizationId: session.organizationId, connectionId: saved.id, provider: definition.provider }, submitted);
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: `integration.${definition.provider}_${action}`, entityType: "IntegrationConnection", entityId: saved.id,
      metadata: { clinicId, credentialsChanged: Boolean(submitted) } } });
    return null;
  });
  if (captured) {
    // No provider HTTP inside a transaction. An overlapping save/disable invalidates
    // the captured version/status; it cannot activate different credentials.
    const observed = await verify(captured.secrets);
    if (!observed.identity || observed.identity.length > 512) optionalProviderFail("integration-provider-identity-invalid", 502);
    if (captured.metadata.providerIdentity && observed.identity !== captured.metadata.providerIdentity) optionalProviderFail("integration-account-binding-mismatch", 409);
    await runSerializableTransaction(async tx => {
      const current = await connectionAt(tx, session.organizationId, definition.provider, clinicId, true);
      if (!current || current.id !== captured.current.id || current.status !== captured.current.status ||
          current.updatedAt.getTime() !== captured.current.updatedAt.getTime() ||
          referenceMetadata(current).configurationVersion !== captured.metadata.configurationVersion) optionalProviderFail("integration-configuration-changed", 409);
      const version = action === "rotate" ? randomUUID() : captured.metadata.configurationVersion;
      if (typeof version !== "string") optionalProviderFail("integration-use-provider-settings", 409);
      // The global primary key, rather than a read-before-write check, arbitrates
      // concurrent claims by different organizations. Shared clinics in the same
      // organization remain valid. Retain ownership until reviewed account transfer.
      const bindingHash = createHash("sha256").update(JSON.stringify([definition.provider, captured.secrets.baseUrl, observed.identity])).digest("hex");
      const bindings = await tx.$queryRawUnsafe<Array<{ id: string }>>(`INSERT INTO "ExternalReference"
        ("id","organizationId","clinicId","connectionId","provider","entityType","internalId","externalId","metadata","createdAt","updatedAt")
        VALUES ($1,$2,NULL,NULL,$3,'PROVIDER_ACCOUNT',$4,$4,'{}'::jsonb,timezone('UTC',clock_timestamp()),timezone('UTC',clock_timestamp()))
        ON CONFLICT ("id") DO UPDATE SET "updatedAt"=timezone('UTC',clock_timestamp())
        WHERE "ExternalReference"."organizationId"=EXCLUDED."organizationId" AND "ExternalReference"."provider"=EXCLUDED."provider"
        RETURNING "id"`, `provider-account-${bindingHash}`, session.organizationId, definition.provider, bindingHash);
      if (bindings.length !== 1) optionalProviderFail("integration-account-owned-by-other-organization", 409);
      await upsertIntegrationConnection(tx, { organizationId: session.organizationId, clinicId, provider: definition.provider, status: "ACTIVE",
        lastVerifiedAt: new Date(), metadata: { ...referenceMetadata(current), configurationVersion: version,
          verifiedVersion: version, providerIdentity: observed.identity, providerBindingHash: bindingHash } });
      if (submitted) await writeIntegrationSecrets(tx, { organizationId: session.organizationId, connectionId: current.id, provider: definition.provider }, submitted);
      await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId, action: `integration.${definition.provider}_${action}`,
        entityType: "IntegrationConnection", entityId: current.id, metadata: { clinicId, credentialsChanged: action === "rotate" } } });
    });
  }
  return getOptionalProviderSettings(session, definition);
}
export async function loadOptionalProviderConnectionForScope(scope: { organizationId: string; clinicId: string }, provider: OptionalProvider) {
  const organization = await prisma.organization.findUnique({ where: { id: scope.organizationId }, select: { isDemo: true } });
  if (!organization || organization.isDemo) optionalProviderFail("integration-demo-unavailable", 403);
  const clinic = await prisma.clinic.findFirst({ where: { id: scope.clinicId, organizationId: scope.organizationId }, select: { id: true } });
  if (!clinic) optionalProviderFail("integration-clinic-forbidden", 403);
  const connection = await findActiveIntegrationConnection(prisma, { ...scope, provider });
  if (!connection || !isVerified(connection)) optionalProviderFail("integration-connection-not-ready", 409);
  const secrets = await readIntegrationSecrets(prisma, { organizationId: scope.organizationId, connectionId: connection.id, provider });
  if (!secrets) optionalProviderFail("integration-credentials-missing", 409);
  optionalProviderBaseUrl(secrets.baseUrl!);
  return { connection, secrets };
}
export async function loadOptionalProviderConnection(session: AppSession, provider: OptionalProvider, clinicId: string) {
  if (session.isDemo) optionalProviderFail("integration-demo-unavailable", 403);
  if (!accessibleClinicIds(session).includes(clinicId)) optionalProviderFail("integration-clinic-forbidden", 403);
  return loadOptionalProviderConnectionForScope({ organizationId: session.organizationId, clinicId }, provider);
}

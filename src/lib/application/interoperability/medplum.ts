import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { canPerformAction } from "@/lib/actions/permissions";
import { patientAccessWhere } from "@/lib/patient-access";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { prisma } from "@/lib/prisma";
import { runSerializableTransaction } from "@/lib/transaction";
import type { AppSession } from "@/lib/session";
import { loadOptionalProviderConnection } from "@/lib/application/integrations/optional-provider-settings";
import { toFhirPatient } from "@/integrations/fhir/patient";
import { fail, medplumConfig, upsertMedplumPatient } from "@/integrations/medplum/client";
import type { MedplumPatientWorkspace, MedplumSyncStatus } from "@/features/integrations/medplum";
import { referenceMetadata, type IntegrationConnectionRecord, type ExternalReferenceRecord } from "@/infrastructure/integrations/phase3-store";

type SyncMetadata = { status: MedplumSyncStatus; attempts: number; attemptId: string; sourceHash: string; targetHash: string;
  lastAttemptAt: string; lastVerifiedAt: string | null; errorCode: string | null };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const select = { id: true, clinicId: true, fullName: true, dateOfBirth: true, gender: true, phone: true, email: true, address: true } as const;

async function context(session: AppSession, patientId: string) {
  if (!canPerformAction(session, "interop.patient.export")) fail("medplum-export-denied", 403);
  if (session.isDemo) fail("medplum-demo-unavailable", 403);
  if (!patientId || patientId.length > 128) fail("medplum-patient-invalid", 400);
  const patient = await prisma.patient.findFirst({ where: { ...patientAccessWhere(session), id: patientId }, select });
  if (!patient || !accessibleClinicIds(session).includes(patient.clinicId)) fail("medplum-patient-not-found", 404);
  if (!canPerformAction({ ...session, activeClinicId: patient.clinicId }, "interop.patient.export")) fail("medplum-export-denied", 403);
  const binding = await loadOptionalProviderConnection(session, "medplum", patient.clinicId);
  const c = binding.connection;
  if (c.organizationId !== session.organizationId || (c.clinicId !== null && c.clinicId !== patient.clinicId) ||
      c.provider !== "medplum" || c.status !== "ACTIVE" || !c.lastVerifiedAt) fail("medplum-connection-unavailable", 409);
  const config = medplumConfig(binding.secrets);
  const identity = { system: `https://codexdentist.com/fhir/organization/${encodeURIComponent(session.organizationId)}/patient`, value: patient.id };
  const resource = toFhirPatient(patient);
  resource.identifier.push(identity);
  const targetHash = hash([config.baseUrl, config.projectId]);
  const sourceHash = hash({ resource, clinicId: patient.clinicId, targetHash });
  const id = `medplum-${hash([session.organizationId, c.id, patient.id])}`;
  return { ...binding, patient, resource, identity, sourceHash, targetHash, id };
}

function summary(metadata?: SyncMetadata, sourceHash?: string): MedplumPatientWorkspace {
  return { status: metadata?.status === "VERIFIED" && metadata.sourceHash !== sourceHash ? "SOURCE_CHANGED" : metadata?.status ?? "NEVER",
    attempts: metadata?.attempts ?? 0, lastAttemptAt: metadata?.lastAttemptAt ?? null,
    lastVerifiedAt: metadata?.lastVerifiedAt ?? null, errorCode: metadata?.errorCode ?? null };
}

export async function getMedplumPatientStatus(session: AppSession, patientId: string) {
  const ctx = await context(session, patientId);
  const row = await prisma.externalReference.findFirst({ where: { id: ctx.id, organizationId: session.organizationId,
    clinicId: ctx.patient.clinicId, provider: "medplum", connectionId: ctx.connection.id, entityType: "Patient", internalId: patientId } });
  return summary(row?.metadata as SyncMetadata | undefined, ctx.sourceHash);
}

export async function exportMedplumPatient(session: AppSession, patientId: string) {
  const ctx = await context(session, patientId);
  const attemptId = randomUUID();
  const metadata = await runSerializableTransaction(async tx => {
    // Lock the connection to serialize initial reservation with key replacement;
    // network I/O happens only after this transaction has committed.
    const connections = await tx.$queryRawUnsafe<(IntegrationConnectionRecord & { now: Date })[]>(
      `SELECT *, timezone('UTC', clock_timestamp()) AS now FROM "IntegrationConnection"
       WHERE id=$1 AND "organizationId"=$2 AND provider='medplum' AND status='ACTIVE'
       AND ("clinicId" IS NULL OR "clinicId"=$3) FOR UPDATE`, ctx.connection.id, session.organizationId, ctx.patient.clinicId);
    const connection = connections[0];
    if (!connection || connection.updatedAt.getTime() !== ctx.connection.updatedAt.getTime()) fail("medplum-connection-changed", 409);
    const currentVersion = referenceMetadata(connection), capturedVersion = referenceMetadata(ctx.connection);
    if (connection.secretRef !== "vault:v1" || !connection.lastVerifiedAt || !currentVersion.configurationVersion ||
        currentVersion.verifiedVersion !== currentVersion.configurationVersion ||
        currentVersion.configurationVersion !== capturedVersion.configurationVersion ||
        !currentVersion.providerIdentity || currentVersion.providerIdentity !== capturedVersion.providerIdentity) fail("medplum-connection-changed", 409);
    const rows = await tx.$queryRawUnsafe<ExternalReferenceRecord[]>(`SELECT * FROM "ExternalReference" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE`, ctx.id, session.organizationId);
    const previous = rows[0]?.metadata as SyncMetadata | undefined;
    if (previous?.status === "PENDING" && connection.now.getTime() - Date.parse(previous.lastAttemptAt) < 300_000) fail("medplum-export-in-progress", 409);
    const next: SyncMetadata = { status: "PENDING", attempts: (previous?.attempts ?? 0) + 1, attemptId,
      sourceHash: ctx.sourceHash, targetHash: ctx.targetHash, lastAttemptAt: connection.now.toISOString(),
      lastVerifiedAt: previous?.targetHash === ctx.targetHash ? previous.lastVerifiedAt : null, errorCode: null };
    await tx.externalReference.upsert({ where: { id: ctx.id }, create: { id: ctx.id, organizationId: session.organizationId,
      clinicId: ctx.patient.clinicId, connectionId: ctx.connection.id, provider: "medplum", entityType: "Patient", internalId: patientId,
      externalId: `pending:${hash(ctx.identity)}`, metadata: next }, update: { metadata: next, clinicId: ctx.patient.clinicId,
        ...(previous?.targetHash !== ctx.targetHash ? { externalId: `pending:${hash(ctx.identity)}` } : {}) } });
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: "interop.medplum_export_requested", entityType: "Patient", entityId: patientId,
      metadata: { connectionId: ctx.connection.id, attemptId } } });
    return next;
  });
  let externalId: string | undefined;
  let errorCode: string | null = null;
  try { externalId = (await upsertMedplumPatient(ctx.secrets, ctx.resource, ctx.identity)).externalId; }
  catch (error) { errorCode = error instanceof Error && /^medplum-[a-z-]+$/.test(error.message) ? error.message : "medplum-provider-unavailable"; }
  await runSerializableTransaction(async tx => {
    const rows = await tx.$queryRawUnsafe<ExternalReferenceRecord[]>(`SELECT * FROM "ExternalReference" WHERE id=$1 AND "organizationId"=$2 FOR UPDATE`, ctx.id, session.organizationId);
    if ((rows[0]?.metadata as SyncMetadata | undefined)?.attemptId !== attemptId) return;
    const current = await tx.patient.findFirst({ where: { ...patientAccessWhere(session), id: patientId }, select });
    const connection = await tx.integrationConnection.findFirst({ where: { id: ctx.connection.id, organizationId: session.organizationId, status: "ACTIVE" } });
    const resource = current ? toFhirPatient(current) : null;
    resource?.identifier.push(ctx.identity);
    const unchanged = current && hash({ resource, clinicId: current.clinicId, targetHash: ctx.targetHash }) === ctx.sourceHash &&
      connection?.updatedAt.getTime() === ctx.connection.updatedAt.getTime();
    metadata.status = errorCode ? "RETRY" : unchanged ? "VERIFIED" : "SOURCE_CHANGED";
    metadata.errorCode = errorCode;
    if (!errorCode) metadata.lastVerifiedAt = new Date().toISOString();
    await tx.externalReference.update({ where: { id: ctx.id }, data: { metadata, ...(externalId ? { externalId } : {}) } });
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: "interop.medplum_export_completed", entityType: "Patient", entityId: patientId,
      metadata: { connectionId: ctx.connection.id, attemptId, status: metadata.status, errorCode } } });
  });
  // Re-read the scoped live source so an edit after completion cannot look current.
  return getMedplumPatientStatus(session, patientId);
}

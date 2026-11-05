import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AppSession } from "@/lib/session";
import { canMutateForms } from "@/lib/forms";
import { accessibleClinicIds } from "@/lib/tenant-scope";
import { canServePatientFile } from "@/lib/resource-policy";
import { runSerializableTransaction } from "@/lib/transaction";
import { findActiveIntegrationConnection, referenceMetadata } from "@/infrastructure/integrations/phase3-store";
import { documensoConnectionSummary, documensoFormRequests } from "@/infrastructure/integrations/documenso-workspace-store";
import { documensoSigningUrl, type DocumensoConsentWorkspace, type DocumensoRequestSummary } from "@/features/integrations/documenso-workspace";
import { documensoFail } from "./documenso-settings";

type DB = Prisma.TransactionClient | typeof prisma;
export function authorizeDocumensoSigning(session: AppSession, mutate = false) {
  if (!canMutateForms(session)) documensoFail("forbidden", 403);
  if (mutate && session.isDemo) documensoFail("documenso-demo-unavailable", 403);
}

export async function scopedDocumensoForm(session: AppSession, patientFormId: string, db: DB = prisma) {
  const form = await db.patientForm.findFirst({ where: { id: patientFormId, organizationId: session.organizationId,
    clinicId: { in: accessibleClinicIds(session) }, patient: { organizationId: session.organizationId } },
    select: { id: true, formNo: true, clinicId: true, patientId: true, status: true, attachments: true,
      signatureUrl: true, expiresAt: true, patient: { select: { fullName: true, email: true, clinicId: true } },
      template: { select: { name: true, requiresSignature: true } } } });
  if (!form?.clinicId || form.patient.clinicId !== form.clinicId) documensoFail("documenso-form-not-found", 404);
  return form;
}

export function documensoSourceWhere(session: AppSession, form: { clinicId: string | null; patientId: string }) {
  return { organizationId: session.organizationId, clinicId: form.clinicId ?? "", patientId: form.patientId, mimeType: "application/pdf",
    AND: [{ OR: [{ retentionUntil: null }, { retentionUntil: { gt: new Date() } }] },
      { OR: [{ storageProvider: { in: ["local", "r2"] } }, { sourceType: { in: ["LOCAL_UPLOAD", "R2_UPLOAD"] } }] }] };
}

export async function getDocumensoConsent(session: AppSession, patientFormId: string): Promise<DocumensoConsentWorkspace> {
  authorizeDocumensoSigning(session);
  const form = await scopedDocumensoForm(session, patientFormId);
  const [connection, files, requests] = await Promise.all([
    findActiveIntegrationConnection(prisma, { organizationId: session.organizationId, clinicId: form.clinicId!, provider: "documenso" }),
    prisma.patientFile.findMany({ where: documensoSourceWhere(session, form), orderBy: { createdAt: "desc" },
      select: { id: true, title: true, fileName: true, virusScanStatus: true } }),
    documensoFormRequests(prisma, session.organizationId, form.id),
  ]);
  if (requests.length > 1 || (requests[0] && requests[0].clinicId !== form.clinicId)) documensoFail("documenso-ceremony-ownership-conflict", 409);
  const eligible = files.filter(file => canServePatientFile(session, file.virusScanStatus));
  const owner = requests[0];
  const metadata = referenceMetadata(owner ?? null);
  const attached = form.attachments.map(url => eligible.find(file => url === `/patient-files/${file.id}`)?.id).filter((id): id is string => Boolean(id));
  const sourceId = typeof metadata.sourcePatientFileId === "string" ? metadata.sourcePatientFileId : attached[attached.length - 1] ?? null;
  const protectedPath = form.signatureUrl?.match(/^\/patient-files\/([A-Za-z0-9_-]{1,128})$/);
  const signedFileUrl = protectedPath && eligible.some(file => file.id === protectedPath[1]) ? form.signatureUrl : null;
  let request: DocumensoRequestSummary | null = null;
  if (owner) {
    const status = ["CREATING", "DISTRIBUTING", "PENDING", "SIGNED", "ERROR", "FAILED", "CANCELLED"].includes(String(metadata.status))
      ? metadata.status as DocumensoRequestSummary["status"] : "UNKNOWN";
    const leaseExpired = typeof metadata.attemptStartedAt === "string" && Date.parse(metadata.attemptStartedAt) <= Date.now() - 120_000;
    request = { id: owner.id, status, sourcePatientFileId: sourceId,
      idempotencyKey: typeof metadata.idempotencyKey === "string" ? metadata.idempotencyKey : null,
      envelopeId: typeof metadata.envelopeId === "string" ? metadata.envelopeId : null,
      signingUrl: documensoSigningUrl(metadata.signingUrl), signedFileUrl, updatedAt: owner.updatedAt.toISOString(),
      canRetry: status === "FAILED" || (status === "ERROR" && Boolean(metadata.envelopeId)) || (status === "DISTRIBUTING" && Boolean(metadata.envelopeId) && leaseExpired),
      errorCode: metadata.errorCode ? "documenso-request-needs-attention" : null };
  }
  const configured = !!connection && documensoConnectionSummary(connection, "").configured && !session.isDemo;
  const open = ["DRAFT", "SENT"].includes(form.status) && !form.signatureUrl && (!form.expiresAt || form.expiresAt > new Date());
  return { patientFormId: form.id, patientId: form.patientId, formNo: form.formNo, status: form.status,
    requiresSignature: form.template.requiresSignature, configured, isDemo: session.isDemo,
    recipient: { name: form.patient.fullName, email: form.patient.email },
    sources: eligible.map(file => ({ id: file.id, name: file.fileName || file.title })),
    sourcePatientFileId: sourceId, request, signedFileUrl,
    canRequest: configured && open && form.template.requiresSignature && Boolean(form.patient.email) &&
      Boolean(sourceId && eligible.some(file => file.id === sourceId) && form.attachments.includes(`/patient-files/${sourceId}`)) && (!request || request.canRetry) };
}

// Call only while holding the PatientForm row lock. A reservation, including an
// uncertain ERROR, owns the source and manual completion/void workflow.
export async function assertNoDocumensoCeremony(tx: Prisma.TransactionClient, organizationId: string, patientFormId: string, allowDefinitiveFailure = false) {
  const requests = await documensoFormRequests(tx, organizationId, patientFormId);
  if (requests.some(row => {
    const metadata = referenceMetadata(row);
    if (allowDefinitiveFailure && metadata.status === "FAILED" && !metadata.envelopeId && metadata.creationUncertain !== true) return false;
    return !["SIGNED", "CANCELLED", "REJECTED"].includes(String(metadata.status));
  })) {
    documensoFail("documenso-ceremony-active", 409);
  }
}

export async function attachDocumensoSource(session: AppSession, patientFormId: string, sourcePatientFileId: string) {
  authorizeDocumensoSigning(session, true);
  if (!patientFormId || !sourcePatientFileId) documensoFail("documenso-signing-request-input-invalid");
  await runSerializableTransaction(async tx => {
    await tx.$executeRawUnsafe(`SELECT "id" FROM "PatientForm" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`, patientFormId, session.organizationId);
    const form = await scopedDocumensoForm(session, patientFormId, tx);
    if (!["DRAFT", "SENT"].includes(form.status) || form.signatureUrl || (form.expiresAt && form.expiresAt <= new Date())) documensoFail("documenso-form-not-open", 409);
    if (!form.template.requiresSignature) documensoFail("documenso-form-signature-not-required", 409);
    await assertNoDocumensoCeremony(tx, session.organizationId, form.id);
    await tx.$executeRawUnsafe(`SELECT "id" FROM "PatientFile" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`, sourcePatientFileId, session.organizationId);
    const file = await tx.patientFile.findFirst({ where: { ...documensoSourceWhere(session, form), id: sourcePatientFileId },
      select: { id: true, virusScanStatus: true } });
    if (!file || !canServePatientFile(session, file.virusScanStatus)) documensoFail("documenso-source-pdf-not-clean", 409);
    const sourceUrl = `/patient-files/${file.id}`;
    await tx.patientForm.update({ where: { id: form.id }, data: { attachments: [...form.attachments.filter(url => url !== sourceUrl), sourceUrl] } });
    await tx.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: "patient_form.signing_source_attached", entityType: "PatientForm", entityId: form.id, metadata: { sourcePatientFileId: file.id } } });
  });
  return getDocumensoConsent(session, patientFormId);
}

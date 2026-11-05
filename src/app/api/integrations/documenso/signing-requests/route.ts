import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { canMutateForms } from "@/lib/forms";
import { readStoredPatientFile } from "@/lib/patient-file-storage";
import { prisma } from "@/lib/prisma";
import { createExternalReference } from "@/infrastructure/integrations/substrate";
import {
  findActiveIntegrationConnection,
  type ExternalReferenceRecord,
  referenceMetadata,
  updateExternalReferenceMetadataWithRetry,
  type IntegrationConnectionRecord,
} from "@/infrastructure/integrations/phase3-store";
import { documensoConnectionSecrets } from "../connection-secrets";
import { documensoJson, documensoError, documensoRequestBody } from "../http";
import { attachDocumensoSource, getDocumensoConsent, documensoSourceWhere } from "@/lib/application/integrations/documenso-signing";
import { documensoSigningUrl } from "@/features/integrations/documenso-workspace";
import {
  createDocumensoSigningEnvelope,
  resumeDocumensoSigningEnvelope,
  DocumensoProviderError,
  type DocumensoSigningEnvelope,
} from "@/integrations/documenso/client";
import { hasSameOrigin } from "@/lib/request-security";
import { allowedClinicIds } from "@/lib/patient-access";
import { canServePatientFile } from "@/lib/resource-policy";
import { runSerializableTransaction } from "@/lib/transaction";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;
const DISTRIBUTION_LEASE_MS = 120_000;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return documensoJson({ error: "unauthorized" }, 401);
  try { return documensoJson(await getDocumensoConsent(session, new URL(request.url).searchParams.get("patientFormId") ?? "")); }
  catch (cause) { return documensoError(cause); }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  if (!canMutateForms(session)) return error("forbidden", 403);
  if (session.isDemo) return error("documenso-demo-unavailable", 403);

  let body: Record<string, unknown>;
  try { body = await documensoRequestBody(request); } catch (cause) { return documensoError(cause); }
  const patientFormId = text(body?.patientFormId);
  const sourcePatientFileId = text(body?.sourcePatientFileId);
  const requestedIdempotencyKey = text(body?.idempotencyKey);
  if (body.action === "attach-source") {
    try { return documensoJson(await attachDocumensoSource(session, patientFormId, sourcePatientFileId)); }
    catch (cause) { return documensoError(cause); }
  }
  if (body.action !== undefined && body.action !== "send") return error("documenso-input-invalid", 400);
  if (!patientFormId || !sourcePatientFileId) {
    return error("documenso-signing-request-input-invalid", 400);
  }
  if (requestedIdempotencyKey && !IDEMPOTENCY_PATTERN.test(requestedIdempotencyKey)) {
    return error("documenso-idempotency-key-invalid", 400);
  }

  const patientForm = await prisma.patientForm.findFirst({
    where: {
      id: patientFormId,
      organizationId: session.organizationId,
      clinicId: { in: allowedClinicIds(session) },
      patient: { organizationId: session.organizationId },
    },
    select: {
      id: true,
      formNo: true,
      status: true,
      clinicId: true,
      patientId: true,
      attachments: true,
      signatureUrl: true,
      expiresAt: true,
      patient: { select: { fullName: true, email: true, clinicId: true } },
      template: {
        select: { name: true, requiresSignature: true },
      },
    },
  });
  if (!patientForm || !patientForm.clinicId || patientForm.patient.clinicId !== patientForm.clinicId) return error("documenso-form-not-found", 404);
  if (!patientForm.template.requiresSignature) {
    return error("documenso-form-signature-not-required", 409);
  }
  if (!["DRAFT", "SENT"].includes(patientForm.status) || patientForm.signatureUrl || (patientForm.expiresAt && patientForm.expiresAt <= new Date())) {
    return error("documenso-form-not-open", 409);
  }
  if (!patientForm.patient.email) return error("documenso-patient-email-required", 409);

  const sourceFile = await prisma.patientFile.findFirst({
    where: {
      ...documensoSourceWhere(session, patientForm),
      id: sourcePatientFileId,
      organizationId: session.organizationId,
      clinicId: patientForm.clinicId,
      patientId: patientForm.patientId,
      mimeType: "application/pdf",
      OR: [{ retentionUntil: null }, { retentionUntil: { gt: new Date() } }],
    },
    select: {
      id: true,
      storageProvider: true,
      sourceType: true,
      storageKey: true,
      sourceId: true,
      virusScanStatus: true,
    },
  });
  if (!sourceFile) return error("documenso-source-pdf-not-found", 404);
  if (!patientForm.attachments.includes(`/patient-files/${sourcePatientFileId}`)) {
    return error("documenso-source-pdf-not-attached-to-form", 409);
  }
  if (!canServePatientFile(session, sourceFile.virusScanStatus)) {
    return error("documenso-source-pdf-not-clean", 409);
  }

  const connection = await findActiveIntegrationConnection(prisma, {
    organizationId: session.organizationId,
    clinicId: patientForm.clinicId,
    provider: "documenso",
  });
  if (!connection) return error("documenso-connection-not-configured", 503);

  // Serialize ownership on the form, not the replaceable provider connection.
  // Commit the reservation before provider I/O so a callback can recover it.
  let reserved;
  try { reserved = await runSerializableTransaction(async (tx) => {
    // Settings replacement takes this same connection lock. Capture credentials
    // and reserve the ceremony before releasing it to any provider HTTP call.
    const connections = await tx.$queryRawUnsafe<IntegrationConnectionRecord[]>(
      `SELECT * FROM "IntegrationConnection" WHERE "id"=$1 AND "organizationId"=$2
       AND "provider"='documenso' AND "status"='ACTIVE' FOR UPDATE`, connection.id, session.organizationId);
    if (!connections[0]) return { error: "documenso-connection-not-configured" } as const;
    const secrets = await documensoConnectionSecrets(connections[0], tx);
    const patients = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "Patient" WHERE "id"=$1 AND "organizationId"=$2 AND "clinicId"=$3 FOR UPDATE`,
      patientForm.patientId, session.organizationId, patientForm.clinicId);
    if (!patients[0]) return { error: "documenso-form-not-found" } as const;
    await tx.$executeRaw`
      SELECT id FROM "PatientForm"
      WHERE id = ${patientForm.id} AND "organizationId" = ${session.organizationId}
        AND "clinicId" = ${patientForm.clinicId} AND "patientId" = ${patientForm.patientId}
      FOR UPDATE
    `;
    const current = await tx.patientForm.findFirst({
      where: { id: patientForm.id, organizationId: session.organizationId,
        clinicId: patientForm.clinicId, patientId: patientForm.patientId },
      select: { status: true, attachments: true, signatureUrl: true, expiresAt: true,
        patient: { select: { fullName: true, email: true, clinicId: true } }, template: { select: { requiresSignature: true } } },
    });
    if (!current || !["DRAFT", "SENT"].includes(current.status) || current.signatureUrl || (current.expiresAt && current.expiresAt <= new Date())) {
      return { error: "documenso-form-not-open" } as const;
    }
    if (!current.template.requiresSignature || current.patient.clinicId !== patientForm.clinicId ||
        current.patient.email !== patientForm.patient.email || current.patient.fullName !== patientForm.patient.fullName) {
      return { error: "documenso-form-changed" } as const;
    }
    if (!current.attachments.includes(`/patient-files/${sourceFile.id}`)) {
      return { error: "documenso-source-pdf-not-attached-to-form" } as const;
    }
    await tx.$queryRawUnsafe(`SELECT "id" FROM "PatientFile" WHERE "id"=$1 AND "organizationId"=$2 FOR UPDATE`, sourceFile.id, session.organizationId);
    const currentFile = await tx.patientFile.findFirst({ where: { ...documensoSourceWhere(session, patientForm), id: sourceFile.id },
      select: { id: true, virusScanStatus: true, storageKey: true } });
    if (!currentFile || !canServePatientFile(session, currentFile.virusScanStatus) || currentFile.storageKey !== sourceFile.storageKey) {
      return { error: "documenso-source-pdf-not-clean" } as const;
    }
    const owners = await tx.$queryRaw<ExternalReferenceRecord[]>`
      SELECT * FROM "ExternalReference"
      WHERE "organizationId" = ${session.organizationId} AND "provider" = 'documenso'
        AND "entityType" = 'DOCUMENSO_REQUEST' AND "internalId" = ${patientForm.id}
      ORDER BY "createdAt", "id"
    `;
    const existing = owners[0];
    if (owners.length > 1 || (existing &&
        (existing.connectionId !== connection.id || existing.clinicId !== patientForm.clinicId))) {
      return { error: "documenso-ceremony-ownership-conflict" } as const;
    }
    const metadata = referenceMetadata(existing ?? null);
    if (existing) {
      if (metadata.sourcePatientFileId !== sourceFile.id) {
        return { error: "documenso-source-pdf-conflict" } as const;
      }
      if (requestedIdempotencyKey && typeof metadata.idempotencyKey === "string" &&
          metadata.idempotencyKey !== requestedIdempotencyKey) {
        return { error: "documenso-idempotency-key-conflict" } as const;
      }
      if (typeof metadata.envelopeId === "string" &&
          (metadata.status === "SIGNED" || metadata.distributionStatus === "SENT" ||
            (metadata.status === "PENDING" && !metadata.errorCode && metadata.distributionStatus !== "PENDING"))) {
        return { reference: existing, duplicate: true, secrets } as const;
      }
      const leaseExpired = typeof metadata.attemptStartedAt === "string" &&
        Date.parse(metadata.attemptStartedAt) <= Date.now() - DISTRIBUTION_LEASE_MS;
      if (metadata.status === "CREATING" ||
          (metadata.status === "DISTRIBUTING" && (!metadata.envelopeId || !leaseExpired))) {
        return { error: "documenso-signing-request-pending-recovery" } as const;
      }
      if (!metadata.envelopeId && metadata.status !== "FAILED") {
        return { error: "documenso-signing-request-pending-recovery" } as const;
      }
    }
    const reference = existing
      ? await updateExternalReferenceMetadataWithRetry(tx, existing.id, {
          ...metadata, status: metadata.envelopeId ? "DISTRIBUTING" : "CREATING",
          attemptStartedAt: new Date().toISOString(),
        })
      : await createExternalReference(tx, {
          organizationId: session.organizationId,
          clinicId: patientForm.clinicId,
          connectionId: connection.id,
          provider: "documenso",
          entityType: "DOCUMENSO_REQUEST",
          internalId: patientForm.id,
          externalId: randomUUID(),
          metadata: { patientFormId: patientForm.id, sourcePatientFileId: sourceFile.id,
            idempotencyKey: requestedIdempotencyKey || null, status: "CREATING",
            attemptStartedAt: new Date().toISOString() },
        });
    return { reference, duplicate: false, secrets } as const;
  }); } catch (cause) { return documensoError(cause); }
  if (reserved.error) return error(reserved.error, 409);
  const requestReference = reserved.reference;
  const requestMetadata = referenceMetadata(requestReference);
  if (reserved.duplicate) {
    return json({ envelopeId: requestMetadata.envelopeId,
      signingUrl: documensoSigningUrl(requestMetadata.signingUrl), status: requestMetadata.status === "SIGNED" ? "SIGNED" : "PENDING", duplicate: true });
  }

  let createdEnvelope: DocumensoSigningEnvelope | null = null;
  let knownEnvelopeId = typeof requestMetadata.envelopeId === "string" ? requestMetadata.envelopeId : null;
  const persistEnvelope = async (envelopeId: string) => {
    knownEnvelopeId = envelopeId;
    await prisma.$transaction(async (tx) => {
      await createExternalReference(tx, {
        organizationId: session.organizationId, clinicId: patientForm.clinicId,
        connectionId: connection.id, provider: "documenso", entityType: "DOCUMENSO_ENVELOPE",
        internalId: patientForm.id, externalId: envelopeId,
        metadata: { patientFormId: patientForm.id, patientId: patientForm.patientId,
          sourcePatientFileId: sourceFile.id, status: "PENDING" },
      });
      await updateExternalReferenceMetadataWithRetry(tx, requestReference.id, {
        ...requestMetadata, status: "DISTRIBUTING", distributionStatus: "PENDING", envelopeId,
      });
    });
  };
  try {
    const secrets = reserved.secrets;
    if (knownEnvelopeId) {
      await persistEnvelope(knownEnvelopeId);
      createdEnvelope = await resumeDocumensoSigningEnvelope(secrets, knownEnvelopeId);
    } else {
      const sourceBytes = await readStoredPatientFile(sourceFile);
      createdEnvelope = await createDocumensoSigningEnvelope(secrets, {
        externalId: patientForm.id,
        title: patientForm.template.name || `Form ${patientForm.formNo}`,
        pdfBytes: sourceBytes,
        fileName: `form-${patientForm.formNo}.pdf`,
        recipientEmail: patientForm.patient.email,
        recipientName: patientForm.patient.fullName,
        redirectUrl: `${appBaseUrl()}/forms?documenso=returned`,
      }, persistEnvelope);
    }

    const envelope = createdEnvelope;
    await updateExternalReferenceMetadataWithRetry(prisma, requestReference.id, {
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestMetadata.idempotencyKey ?? (requestedIdempotencyKey || null),
      status: "PENDING",
      distributionStatus: "SENT",
      envelopeId: envelope.envelopeId,
      signingUrl: documensoSigningUrl(envelope.signingUrl),
    });
    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: session.userId,
        action: "patient_form.signing_requested",
        entityType: "PatientForm",
        entityId: patientForm.id,
        metadata: {
          provider: "documenso",
          envelopeId: envelope.envelopeId,
          sourcePatientFileId: sourceFile.id,
        },
      },
    });
    return json({
      envelopeId: envelope.envelopeId,
      signingUrl: documensoSigningUrl(envelope.signingUrl),
      status: "PENDING",
      duplicate: false,
    });
  } catch (cause) {
    const previousMetadata = referenceMetadata(requestReference);
    const providerEnvelopeId =
      createdEnvelope?.envelopeId ??
      (cause instanceof DocumensoProviderError ? cause.envelopeId : undefined) ?? knownEnvelopeId;
    const rejected = !providerEnvelopeId && cause instanceof DocumensoProviderError &&
      cause.code === "documenso-envelope-create-failed" && [400, 401, 403, 422].includes(cause.status) &&
      previousMetadata.creationUncertain !== true;
    await updateExternalReferenceMetadataWithRetry(prisma, requestReference.id, {
      ...previousMetadata,
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestMetadata.idempotencyKey ?? (requestedIdempotencyKey || null),
      status: createdEnvelope ? "PENDING" : rejected ? "FAILED" : "ERROR",
      creationUncertain: !createdEnvelope && !providerEnvelopeId && !rejected,
      distributionStatus: createdEnvelope ? "SENT" : "PENDING",
      ...(providerEnvelopeId
        ? {
            envelopeId: providerEnvelopeId,
            signingUrl: documensoSigningUrl(createdEnvelope?.signingUrl),
          }
        : {}),
      errorCode: errorCode(cause, "documenso-signing-request-failed"),
    }).catch(() => {});
    return error("documenso-signing-request-failed", 502);
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorCode(cause: unknown, fallback: string) {
  const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code) : "";
  return /^(?:documenso-|integration-)[a-z0-9-]{1,90}$/.test(code) ? code : fallback;
}

function error(code: string, status: number) {
  return json({ error: code }, { status });
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...(init?.headers ?? {}) },
  });
}

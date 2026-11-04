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
} from "@/infrastructure/integrations/phase3-store";
import { resolveDocumensoConnectionSecrets } from "@/integrations/config";
import {
  createDocumensoSigningEnvelope,
  resumeDocumensoSigningEnvelope,
  DocumensoProviderError,
  type DocumensoSigningEnvelope,
} from "@/integrations/documenso/client";
import { hasSameOrigin } from "@/lib/request-security";
import { allowedClinicIds } from "@/lib/patient-access";
import { canServePatientFile } from "@/lib/resource-policy";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;
const DISTRIBUTION_LEASE_MS = 120_000;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  if (!canMutateForms(session)) return error("forbidden", 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientFormId = text(body?.patientFormId);
  const sourcePatientFileId = text(body?.sourcePatientFileId);
  const requestedIdempotencyKey = text(body?.idempotencyKey);
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
    },
    select: {
      id: true,
      formNo: true,
      status: true,
      clinicId: true,
      patientId: true,
      attachments: true,
      patient: { select: { fullName: true, email: true } },
      template: {
        select: { name: true, requiresSignature: true },
      },
    },
  });
  if (!patientForm || !patientForm.clinicId) return error("documenso-form-not-found", 404);
  if (!patientForm.template.requiresSignature) {
    return error("documenso-form-signature-not-required", 409);
  }
  if (!["DRAFT", "SENT"].includes(patientForm.status)) {
    return error("documenso-form-not-open", 409);
  }
  if (!patientForm.patient.email) return error("documenso-patient-email-required", 409);

  const sourceFile = await prisma.patientFile.findFirst({
    where: {
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
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      SELECT id FROM "PatientForm"
      WHERE id = ${patientForm.id} AND "organizationId" = ${session.organizationId}
        AND "clinicId" = ${patientForm.clinicId} AND "patientId" = ${patientForm.patientId}
      FOR UPDATE
    `;
    const current = await tx.patientForm.findFirst({
      where: { id: patientForm.id, organizationId: session.organizationId,
        clinicId: patientForm.clinicId, patientId: patientForm.patientId },
      select: { status: true, attachments: true },
    });
    if (!current || !["DRAFT", "SENT"].includes(current.status)) {
      return { error: "documenso-form-not-open" } as const;
    }
    if (!current.attachments.includes(`/patient-files/${sourceFile.id}`)) {
      return { error: "documenso-source-pdf-not-attached-to-form" } as const;
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
        return { reference: existing, duplicate: true } as const;
      }
      const leaseExpired = typeof metadata.attemptStartedAt === "string" &&
        Date.parse(metadata.attemptStartedAt) <= Date.now() - DISTRIBUTION_LEASE_MS;
      if (metadata.status === "CREATING" ||
          (metadata.status === "DISTRIBUTING" && (!metadata.envelopeId || !leaseExpired))) {
        return { error: "documenso-signing-request-pending-recovery" } as const;
      }
      if (!metadata.envelopeId && metadata.status !== "ERROR") {
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
    return { reference, duplicate: false } as const;
  });
  if (reserved.error) return error(reserved.error, 409);
  const requestReference = reserved.reference;
  const requestMetadata = referenceMetadata(requestReference);
  if (reserved.duplicate) {
    return json({ envelopeId: requestMetadata.envelopeId,
      signingUrl: requestMetadata.signingUrl ?? null, status: requestMetadata.status ?? "PENDING", duplicate: true });
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
    const secrets = resolveDocumensoConnectionSecrets(connection.secretRef);
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
      signingUrl: envelope.signingUrl,
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
      signingUrl: envelope.signingUrl,
      status: "PENDING",
      duplicate: false,
    });
  } catch (cause) {
    const previousMetadata = referenceMetadata(requestReference);
    const providerEnvelopeId =
      createdEnvelope?.envelopeId ??
      (cause instanceof DocumensoProviderError ? cause.envelopeId : undefined) ?? knownEnvelopeId;
    await updateExternalReferenceMetadataWithRetry(prisma, requestReference.id, {
      ...previousMetadata,
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestMetadata.idempotencyKey ?? (requestedIdempotencyKey || null),
      status: createdEnvelope ? "PENDING" : "ERROR",
      distributionStatus: createdEnvelope ? "SENT" : "PENDING",
      ...(providerEnvelopeId
        ? {
            envelopeId: providerEnvelopeId,
            signingUrl: createdEnvelope?.signingUrl ?? null,
          }
        : {}),
      errorCode: errorCode(cause, "documenso-signing-request-failed"),
    }).catch(() => {});
    return error(errorCode(cause, "documenso-signing-request-failed"), 502);
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorCode(cause: unknown, fallback: string) {
  return cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code || fallback)
    : fallback;
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

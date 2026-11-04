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
  claimExternalReferenceForRetry,
  getExternalReferenceByInternalId,
  referenceMetadata,
  updateExternalReferenceMetadataWithRetry,
} from "@/infrastructure/integrations/phase3-store";
import { resolveDocumensoConnectionSecrets } from "@/integrations/config";
import {
  createDocumensoSigningEnvelope,
  DocumensoProviderError,
  type DocumensoSigningEnvelope,
} from "@/integrations/documenso/client";
import { hasSameOrigin } from "@/lib/request-security";
import { allowedClinicIds } from "@/lib/patient-access";
import { canServePatientFile } from "@/lib/resource-policy";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

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

  // A PatientForm owns exactly one managed Documenso signing ceremony. Caller
  // idempotency keys are recorded only as request metadata and cannot create a
  // second envelope for the same form.
  const existingRequest = await getExternalReferenceByInternalId(prisma, {
    organizationId: session.organizationId,
    connectionId: connection.id,
    provider: "documenso",
    entityType: "DOCUMENSO_REQUEST",
    internalId: patientForm.id,
  });
  if (existingRequest) {
    const metadata = referenceMetadata(existingRequest);
    if (metadata.sourcePatientFileId !== sourceFile.id) {
      return error("documenso-source-pdf-conflict", 409);
    }
    if (
      requestedIdempotencyKey &&
      typeof metadata.idempotencyKey === "string" &&
      metadata.idempotencyKey !== requestedIdempotencyKey
    ) {
      return error("documenso-idempotency-key-conflict", 409);
    }
    if (typeof metadata.envelopeId === "string") {
      return json({
        envelopeId: metadata.envelopeId,
        signingUrl: typeof metadata.signingUrl === "string" ? metadata.signingUrl : null,
        status: metadata.status ?? "PENDING",
        duplicate: true,
      });
    }
    if (referenceMetadata(existingRequest).status !== "ERROR") {
      return error("documenso-signing-request-pending-recovery", 409);
    }
  }

  const requestReference = existingRequest ?? await createExternalReference(prisma, {
    organizationId: session.organizationId,
    clinicId: patientForm.clinicId,
    connectionId: connection.id,
    provider: "documenso",
    entityType: "DOCUMENSO_REQUEST",
    internalId: patientForm.id,
    externalId: randomUUID(),
    metadata: {
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestedIdempotencyKey || null,
      status: "CREATING",
    },
  });
  if (!existingRequest && !("created" in requestReference && requestReference.created)) {
    const metadata = referenceMetadata(requestReference);
    if (typeof metadata.envelopeId === "string") {
      return json({
        envelopeId: metadata.envelopeId,
        signingUrl: typeof metadata.signingUrl === "string" ? metadata.signingUrl : null,
        status: metadata.status ?? "PENDING",
        duplicate: true,
      });
    }
    return error("documenso-signing-request-pending-recovery", 409);
  }
  if (existingRequest) {
    const claimed = await claimExternalReferenceForRetry(prisma, requestReference.id);
    if (!claimed) {
      const current = await getExternalReferenceByInternalId(prisma, {
        organizationId: session.organizationId,
        connectionId: connection.id,
        provider: "documenso",
        entityType: "DOCUMENSO_REQUEST",
        internalId: patientForm.id,
      });
      const metadata = referenceMetadata(current);
      if (current && typeof metadata.envelopeId === "string") {
        return json({ envelopeId: metadata.envelopeId, signingUrl: typeof metadata.signingUrl === "string" ? metadata.signingUrl : null, status: metadata.status ?? "PENDING", duplicate: true });
      }
      return error("documenso-signing-request-pending-recovery", 409);
    }
  }

  let createdEnvelope: DocumensoSigningEnvelope | null = null;
  try {
    const sourceBytes = await readStoredPatientFile(sourceFile);
    const secrets = resolveDocumensoConnectionSecrets(connection.secretRef);
    createdEnvelope = await createDocumensoSigningEnvelope(secrets, {
      externalId: patientForm.id,
      title: patientForm.template.name || `Form ${patientForm.formNo}`,
      pdfBytes: sourceBytes,
      fileName: `form-${patientForm.formNo}.pdf`,
      recipientEmail: patientForm.patient.email,
      recipientName: patientForm.patient.fullName,
      redirectUrl: `${appBaseUrl()}/forms?documenso=returned`,
    });

    const envelope = createdEnvelope;
    await createExternalReference(prisma, {
      organizationId: session.organizationId,
      clinicId: patientForm.clinicId,
      connectionId: connection.id,
      provider: "documenso",
      entityType: "DOCUMENSO_ENVELOPE",
      internalId: patientForm.id,
      externalId: envelope.envelopeId,
      metadata: {
        patientFormId: patientForm.id,
        patientId: patientForm.patientId,
        sourcePatientFileId: sourceFile.id,
        status: "PENDING",
      },
    });
    await updateExternalReferenceMetadataWithRetry(prisma, requestReference.id, {
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestedIdempotencyKey || null,
      status: "PENDING",
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
      (cause instanceof DocumensoProviderError ? cause.envelopeId : undefined);
    await updateExternalReferenceMetadataWithRetry(prisma, requestReference.id, {
      ...previousMetadata,
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestedIdempotencyKey || null,
      status: providerEnvelopeId ? "PENDING" : "ERROR",
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

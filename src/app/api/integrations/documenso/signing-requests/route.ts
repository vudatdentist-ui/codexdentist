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
  getExternalReferenceByInternalId,
  referenceMetadata,
  updateExternalReferenceMetadata,
} from "@/infrastructure/integrations/phase3-store";
import { resolveDocumensoConnectionSecrets } from "@/integrations/config";
import { createDocumensoSigningEnvelope } from "@/integrations/documenso/client";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

export async function POST(request: Request) {
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
      clinicId: { in: session.clinicIds },
    },
    select: {
      id: true,
      formNo: true,
      status: true,
      clinicId: true,
      patientId: true,
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
    },
    select: {
      id: true,
      storageProvider: true,
      storageKey: true,
      sourceId: true,
    },
  });
  if (!sourceFile) return error("documenso-source-pdf-not-found", 404);

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
      return NextResponse.json({
        envelopeId: metadata.envelopeId,
        signingUrl: typeof metadata.signingUrl === "string" ? metadata.signingUrl : null,
        status: metadata.status ?? "PENDING",
        duplicate: true,
      });
    }
    return error("documenso-signing-request-pending-recovery", 409);
  }

  const requestReference = await createExternalReference(prisma, {
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

  try {
    const sourceBytes = await readStoredPatientFile(sourceFile);
    const secrets = resolveDocumensoConnectionSecrets(connection.secretRef);
    const envelope = await createDocumensoSigningEnvelope(secrets, {
      externalId: patientForm.id,
      title: patientForm.template.name || `Form ${patientForm.formNo}`,
      pdfBytes: sourceBytes,
      fileName: `form-${patientForm.formNo}.pdf`,
      recipientEmail: patientForm.patient.email,
      recipientName: patientForm.patient.fullName,
      redirectUrl: `${appBaseUrl()}/forms?documenso=returned`,
    });

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
    await updateExternalReferenceMetadata(prisma, requestReference.id, {
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
    return NextResponse.json({
      envelopeId: envelope.envelopeId,
      signingUrl: envelope.signingUrl,
      status: "PENDING",
      duplicate: false,
    });
  } catch (cause) {
    await updateExternalReferenceMetadata(prisma, requestReference.id, {
      patientFormId: patientForm.id,
      sourcePatientFileId: sourceFile.id,
      idempotencyKey: requestedIdempotencyKey || null,
      status: "ERROR",
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
  return NextResponse.json({ error: code }, { status });
}

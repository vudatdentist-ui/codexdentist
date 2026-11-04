import { randomInt, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canPerformAction } from "@/lib/actions/permissions";
import { getSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createExternalReference } from "@/infrastructure/integrations/substrate";
import {
  type ExternalReferenceRecord,
  findActiveIntegrationConnection,
  claimExternalReferenceForRetry,
  getExternalReferenceByInternalId,
  referenceMetadata,
  updateExternalReferenceMetadataWithRetry,
} from "@/infrastructure/integrations/phase3-store";
import { resolvePayOSConnectionSecrets } from "@/integrations/config";
import { createPayOSPaymentLink, type PayOSPaymentLink } from "@/integrations/payos/client";
import { hasSameOrigin } from "@/lib/request-security";
import { allowedClinicIds } from "@/lib/patient-access";

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9_.:-]{8,120}$/;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return error("csrf-origin-invalid", 403);
  const session = await getSession();
  if (!session) return error("unauthorized", 401);
  if (!canPerformAction(session, "billing.receipt.record")) return error("forbidden", 403);

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const patientId = text(body?.patientId);
  const invoiceNo = text(body?.invoiceNo) || null;
  const amount = Number(body?.amount);
  const requestedIdempotencyKey = text(body?.idempotencyKey);
  if (!patientId || !Number.isSafeInteger(amount) || amount <= 0) {
    return error("payos-payment-link-input-invalid", 400);
  }
  if (requestedIdempotencyKey && !IDEMPOTENCY_PATTERN.test(requestedIdempotencyKey)) {
    return error("payos-idempotency-key-invalid", 400);
  }

  const patient = await prisma.patient.findFirst({
    where: {
      id: patientId,
      organizationId: session.organizationId,
      clinicId: { in: allowedClinicIds(session) },
    },
    select: { id: true, clinicId: true },
  });
  if (!patient) return error("payos-patient-not-found", 404);

  if (invoiceNo) {
    const invoice = await prisma.invoice.findFirst({
      where: {
        organizationId: session.organizationId,
        clinicId: patient.clinicId,
        patientId: patient.id,
        invoiceNo,
        status: { not: "VOID" },
      },
      select: { amount: true, paidAmount: true },
    });
    if (!invoice) return error("payos-invoice-not-found", 404);
    const balance = Math.max(Number(invoice.amount) - Number(invoice.paidAmount), 0);
    if (balance <= 0 || amount > balance) return error("payos-invoice-amount-invalid", 409);
  }

  const connection = await findActiveIntegrationConnection(prisma, {
    organizationId: session.organizationId,
    clinicId: patient.clinicId,
    provider: "payos",
  });
  if (!connection) return error("payos-connection-not-configured", 503);

  const internalId = requestedIdempotencyKey || `payos_${randomUUID()}`;
  let retryIntent: ExternalReferenceRecord | null = null;
  if (requestedIdempotencyKey) {
    const existing = await getExternalReferenceByInternalId(prisma, {
      organizationId: session.organizationId,
      connectionId: connection.id,
      provider: "payos",
      entityType: "PAYOS_ORDER",
      internalId,
    });
    if (existing) {
      const metadata = referenceMetadata(existing);
      if (metadata.patientId !== patient.id || Number(metadata.amount) !== amount ||
          String(metadata.invoiceNo ?? "") !== String(invoiceNo ?? "")) {
        return error("payos-idempotency-key-conflict", 409);
      }
      if (typeof metadata.checkoutUrl === "string") {
        return json({
          orderCode: Number(existing.externalId),
          paymentLinkId: metadata.paymentLinkId ?? null,
          checkoutUrl: metadata.checkoutUrl,
          qrCode: metadata.qrCode ?? null,
          status: metadata.status ?? "PENDING",
          duplicate: true,
        });
      }
      if (metadata.status !== "ERROR") {
        return error("payos-payment-link-pending-recovery", 409);
      }
      retryIntent = existing;
    }
  }

  const orderCode = retryIntent ? Number(retryIntent.externalId) : nextOrderCode();
  const intent = retryIntent ?? await createExternalReference(prisma, {
    organizationId: session.organizationId,
    clinicId: patient.clinicId,
    connectionId: connection.id,
    provider: "payos",
    entityType: "PAYOS_ORDER",
    internalId,
    externalId: String(orderCode),
    metadata: {
      patientId: patient.id,
      clinicId: patient.clinicId,
      amount,
      invoiceNo,
      currency: "VND",
      status: "CREATING",
    },
  });
  if (!retryIntent && !("created" in intent && intent.created)) {
    const metadata = referenceMetadata(intent);
    if (typeof metadata.checkoutUrl === "string") {
      return json({
        orderCode: Number(intent.externalId),
        paymentLinkId: metadata.paymentLinkId ?? null,
        checkoutUrl: metadata.checkoutUrl,
        qrCode: metadata.qrCode ?? null,
        status: metadata.status ?? "PENDING",
        duplicate: true,
      });
    }
    return error("payos-payment-link-pending-recovery", 409);
  }
  if (retryIntent) {
    const claimed = await claimExternalReferenceForRetry(prisma, intent.id);
    if (!claimed) {
      const current = await getExternalReferenceByInternalId(prisma, {
        organizationId: session.organizationId,
        connectionId: connection.id,
        provider: "payos",
        entityType: "PAYOS_ORDER",
        internalId,
      });
      const metadata = referenceMetadata(current);
      if (current && typeof metadata.checkoutUrl === "string") {
        return json({ orderCode: Number(current.externalId), paymentLinkId: metadata.paymentLinkId ?? null, checkoutUrl: metadata.checkoutUrl, qrCode: metadata.qrCode ?? null, status: metadata.status ?? "PENDING", duplicate: true });
      }
      return error("payos-payment-link-pending-recovery", 409);
    }
  }

  let createdPaymentLink: PayOSPaymentLink | null = null;
  try {
    const secrets = resolvePayOSConnectionSecrets(connection.secretRef);
    const base = appBaseUrl();
    createdPaymentLink = await createPayOSPaymentLink(secrets, {
      orderCode,
      amount,
      description: `CDX ${String(orderCode).slice(-12)}`,
      cancelUrl: `${base}/billing?payos=cancelled`,
      returnUrl: `${base}/billing?payos=returned`,
      expiredAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    });
    const paymentLink = createdPaymentLink;
    await updateExternalReferenceMetadataWithRetry(prisma, intent.id, {
      patientId: patient.id,
      clinicId: patient.clinicId,
      amount,
      invoiceNo,
      currency: "VND",
      status: "PENDING",
      paymentLinkId: paymentLink.paymentLinkId,
      checkoutUrl: paymentLink.checkoutUrl,
      qrCode: paymentLink.qrCode,
      providerStatus: paymentLink.status,
    });
    await prisma.auditLog.create({
      data: {
        organizationId: session.organizationId,
        actorId: session.userId,
        action: "payos.payment_link_created",
        entityType: "ExternalReference",
        entityId: intent.id,
        metadata: {
          clinicId: patient.clinicId,
          patientId: patient.id,
          invoiceNo,
          orderCode,
          amount,
          paymentLinkId: paymentLink.paymentLinkId,
        },
      },
    });
    return json({
      orderCode,
      paymentLinkId: paymentLink.paymentLinkId,
      checkoutUrl: paymentLink.checkoutUrl,
      qrCode: paymentLink.qrCode,
      status: paymentLink.status ?? "PENDING",
      duplicate: false,
    });
  } catch (cause) {
    const previousMetadata = referenceMetadata(intent);
    await updateExternalReferenceMetadataWithRetry(prisma, intent.id, {
      ...previousMetadata,
      patientId: patient.id,
      clinicId: patient.clinicId,
      amount,
      invoiceNo,
      currency: "VND",
      status: createdPaymentLink ? "PENDING" : "ERROR",
      ...(createdPaymentLink
        ? {
            paymentLinkId: createdPaymentLink.paymentLinkId,
            checkoutUrl: createdPaymentLink.checkoutUrl,
            qrCode: createdPaymentLink.qrCode,
            providerStatus: createdPaymentLink.status,
          }
        : {}),
      errorCode: errorCode(cause, "payos-payment-link-create-failed"),
    }).catch(() => {});
    return error(errorCode(cause, "payos-payment-link-create-failed"), 502);
  }
}

function nextOrderCode() {
  return Date.now() * 100 + randomInt(10, 100);
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

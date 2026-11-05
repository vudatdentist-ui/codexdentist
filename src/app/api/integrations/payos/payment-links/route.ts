import { getSession } from "@/lib/auth";
import { appBaseUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { hasSameOrigin } from "@/lib/request-security";
import { getPayOSInvoice, reservePayOSOrder } from "@/lib/application/integrations/payos-orders";
import { referenceMetadata, updateExternalReferenceMetadataWithRetry } from "@/infrastructure/integrations/phase3-store";
import { createPayOSPaymentLink, PayOSProviderError, type PayOSPaymentLink } from "@/integrations/payos/client";
import { payOSConnectionSecrets } from "../connection-secrets";
import { payOSJson, payOSError, payOSRequestBody } from "../http";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return payOSJson({ error: "unauthorized" }, 401);
  const url = new URL(request.url);
  try { return payOSJson(await getPayOSInvoice(session, url.searchParams.get("patientId") ?? "", url.searchParams.get("invoiceNo") ?? "")); }
  catch (cause) { return payOSError(cause); }
}
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return payOSJson({ error: "csrf-origin-invalid" }, 403);
  const session = await getSession();
  if (!session) return payOSJson({ error: "unauthorized" }, 401);
  let input;
  let reservation;
  try {
    const body = await payOSRequestBody(request);
    input = { patientId: typeof body.patientId === "string" ? body.patientId.trim() : "",
      invoiceNo: typeof body.invoiceNo === "string" && body.invoiceNo.trim() ? body.invoiceNo.trim() : null,
      amount: Number(body.amount), idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "" };
    reservation = await reservePayOSOrder(session, input, payOSConnectionSecrets);
  } catch (cause) { return payOSError(cause); }
  const { intent, secrets } = reservation;
  const previous = referenceMetadata(intent);
  if (reservation.duplicate) {
    if (typeof previous.checkoutUrl !== "string" && previous.status !== "SETTLED") return payOSJson({ error: "payos-payment-link-pending-recovery" }, 409);
    return payOSJson({ orderCode: Number(intent.externalId), paymentLinkId: previous.paymentLinkId ?? null,
      checkoutUrl: previous.checkoutUrl ?? null, qrCode: previous.qrCode ?? null, status: previous.status ?? "PENDING", duplicate: true });
  }
  let created: PayOSPaymentLink | null = null;
  try {
    const base = appBaseUrl();
    created = await createPayOSPaymentLink(secrets, { orderCode: Number(intent.externalId), amount: input.amount,
      // Unlinked bank accounts accept a maximum nine-character transfer memo.
      // The full unique order code remains the canonical payment identity.
      description: `CDX${intent.externalId.slice(-6)}`, cancelUrl: `${base}/billing?payos=cancelled`,
      returnUrl: `${base}/billing?payos=returned`, expiredAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60 });
    await updateExternalReferenceMetadataWithRetry(prisma, intent.id, { ...previous, status: "PENDING",
      paymentLinkId: created.paymentLinkId, checkoutUrl: created.checkoutUrl, qrCode: created.qrCode, providerStatus: created.status });
    await prisma.auditLog.create({ data: { organizationId: session.organizationId, actorId: session.userId,
      action: "payos.payment_link_created", entityType: "ExternalReference", entityId: intent.id,
      metadata: { clinicId: intent.clinicId, patientId: input.patientId, invoiceNo: input.invoiceNo,
        orderCode: Number(intent.externalId), amount: input.amount, paymentLinkId: created.paymentLinkId } } });
    return payOSJson({ ...created, duplicate: false });
  } catch (cause) {
    // Retain an authenticated provider response if a later DB/audit step fails.
    const rejected = cause instanceof PayOSProviderError && cause.code === "payos-payment-link-create-failed" &&
      [400, 401, 403, 422].includes(cause.status);
    // A rejection of this attempt says nothing about a previously timed-out
    // creation. Never permit merchant replacement while that order may exist.
    const uncertain = previous.creationUncertain === true || previous.status === "ERROR" || !rejected;
    await updateExternalReferenceMetadataWithRetry(prisma, intent.id, { ...previous,
      creationUncertain: !created && uncertain,
      status: created ? "PENDING" : uncertain ? "ERROR" : "FAILED", ...(created ? { paymentLinkId: created.paymentLinkId,
        checkoutUrl: created.checkoutUrl, qrCode: created.qrCode, providerStatus: created.status } : {}) });
    return payOSError(cause);
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  acceptIntegrationInbox,
  createExternalReference,
  processIntegrationInbox,
} from "@/infrastructure/integrations/substrate";
import {
  getExternalReferenceByExternalId,
  getIntegrationConnectionById,
  lockExternalReferenceByExternalId,
  referenceMetadata,
  updateExternalReferenceMetadata,
} from "@/infrastructure/integrations/phase3-store";
import { recordProviderSettlementCommand } from "@/lib/application/revenue/provider-settlement";
import { resolvePayOSConnectionSecrets } from "@/integrations/config";
import {
  minimalPayOSWebhookPayload,
  payOSWebhookEventId,
  verifyPayOSWebhookPayload,
} from "@/integrations/payos/client";

export async function POST(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await context.params;
  const connection = await getIntegrationConnectionById(prisma, connectionId, "payos");
  if (!connection || connection.status !== "ACTIVE") {
    return error("payos-connection-not-found", 404);
  }

  let verified;
  try {
    const payload = await request.json();
    const secrets = resolvePayOSConnectionSecrets(connection.secretRef);
    verified = verifyPayOSWebhookPayload(payload, secrets.checksumKey);
  } catch (cause) {
    return error(errorCode(cause, "payos-webhook-invalid"), statusCode(cause, 400));
  }

  // Verification deliberately happens before any inbox insert or business mutation.
  await prisma.$executeRawUnsafe(
    `UPDATE "IntegrationConnection"
     SET "lastVerifiedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
     WHERE "id" = $1`,
    connection.id,
  );

  const orderCode = String(verified.data.orderCode);
  const orderRef = await getExternalReferenceByExternalId(prisma, {
    organizationId: connection.organizationId,
    connectionId: connection.id,
    provider: "payos",
    entityType: "PAYOS_ORDER",
    externalId: orderCode,
  });
  if (!orderRef) return error("payos-order-not-found", 404);
  if (!orderRef.clinicId) return error("payos-order-clinic-missing", 409);

  const eventId = payOSWebhookEventId(verified);
  const minimal = minimalPayOSWebhookPayload(verified);
  let accepted;
  try {
    accepted = await acceptIntegrationInbox(prisma, {
      organizationId: connection.organizationId,
      clinicId: orderRef.clinicId,
      connectionId: connection.id,
      provider: "payos",
      externalEventId: eventId,
      eventType: "payment.webhook",
      payload: minimal,
    });
  } catch (cause) {
    return error(errorCode(cause, "payos-inbox-rejected"), 409);
  }

  try {
    const processed = await processIntegrationInbox(
      prisma,
      accepted.event.id,
      async (tx) => {
        const locked = await lockExternalReferenceByExternalId(tx, {
          organizationId: connection.organizationId,
          connectionId: connection.id,
          provider: "payos",
          entityType: "PAYOS_ORDER",
          externalId: orderCode,
        });
        if (!locked || !locked.clinicId) throw coded("payos-order-not-found");
        const metadata = referenceMetadata(locked);
        if (metadata.status === "SETTLED") {
          return {
            status: "already_settled" as const,
            receiptId: typeof metadata.receiptId === "string" ? metadata.receiptId : null,
          };
        }

        const expectedAmount = Number(metadata.amount);
        const patientId = typeof metadata.patientId === "string" ? metadata.patientId : "";
        const invoiceNo = typeof metadata.invoiceNo === "string" ? metadata.invoiceNo : null;
        const expectedPaymentLinkId =
          typeof metadata.paymentLinkId === "string" ? metadata.paymentLinkId : null;
        if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || !patientId) {
          throw coded("payos-order-metadata-invalid");
        }
        if (
          expectedPaymentLinkId &&
          minimal.paymentLinkId &&
          expectedPaymentLinkId !== minimal.paymentLinkId
        ) {
          throw coded("payos-payment-link-mismatch");
        }

        const isSuccessful =
          minimal.success === true &&
          minimal.code === "00" &&
          (!minimal.transactionCode || minimal.transactionCode === "00");
        if (!isSuccessful) {
          await updateExternalReferenceMetadata(tx, locked.id, {
            ...metadata,
            status: "PENDING",
            lastEventId: eventId,
            lastEventCode: minimal.transactionCode ?? minimal.code,
            lastEventAt: minimal.transactionDateTime ?? new Date().toISOString(),
          });
          return { status: "ignored_non_success" as const, receiptId: null };
        }
        if (minimal.currency && minimal.currency.toUpperCase() !== "VND") {
          throw coded("payos-currency-mismatch");
        }
        if (minimal.amount !== expectedAmount) {
          throw coded("payos-amount-mismatch");
        }

        const providerReference =
          minimal.reference || `payos:${orderCode}:${eventId.slice(0, 16)}`;
        const settlement = await recordProviderSettlementCommand(tx, {
          organizationId: connection.organizationId,
          clinicId: locked.clinicId,
          patientId,
          amount: expectedAmount,
          method: "bank_transfer",
          provider: "payos",
          providerReference,
          providerEventId: eventId,
          invoiceNo,
        });
        await createExternalReference(tx, {
          organizationId: connection.organizationId,
          clinicId: locked.clinicId,
          connectionId: connection.id,
          provider: "payos",
          entityType: "PAYOS_SETTLEMENT",
          internalId: settlement.receiptId,
          externalId: providerReference,
          metadata: {
            orderCode,
            eventId,
            amount: expectedAmount,
          },
        });
        await updateExternalReferenceMetadata(tx, locked.id, {
          ...metadata,
          status: "SETTLED",
          receiptId: settlement.receiptId,
          receiptNo: settlement.receiptNo,
          settledReference: providerReference,
          settledEventId: eventId,
          settledAt: new Date().toISOString(),
        });
        return { status: "settled" as const, receiptId: settlement.receiptId };
      },
      { maxAttempts: 5, retryDelayMs: 5_000 },
    );
    return NextResponse.json({
      ok: true,
      duplicate: accepted.duplicate,
      inboxStatus: processed.status,
      result: processed.result,
    });
  } catch (cause) {
    return error(errorCode(cause, "payos-processing-failed"), 500);
  }
}

function coded(code: string) {
  return Object.assign(new Error(code), { code });
}

function errorCode(cause: unknown, fallback: string) {
  return cause && typeof cause === "object" && "code" in cause
    ? String((cause as { code?: unknown }).code || fallback)
    : fallback;
}

function statusCode(cause: unknown, fallback: number) {
  return cause && typeof cause === "object" && "status" in cause
    ? Number((cause as { status?: unknown }).status) || fallback
    : fallback;
}

function error(code: string, status: number) {
  return NextResponse.json({ error: code }, { status });
}

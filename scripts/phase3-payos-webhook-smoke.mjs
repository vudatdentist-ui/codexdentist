import { createHmac, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const {
  createExternalReference,
  upsertIntegrationConnection,
} = await import("../src/infrastructure/integrations/substrate.ts");
const { getExternalReferenceByExternalId, referenceMetadata } = await import(
  "../src/infrastructure/integrations/phase3-store.ts"
);

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/vietnam_dental_suite?schema=public";
const baseUrl = process.env.PHASE3_APP_URL ?? "http://127.0.0.1:3000";
const checksumKey =
  process.env.PAYOS_CI_CHECKSUM_KEY ?? "ci-phase3-payos-checksum-secret";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const suffix = randomUUID().replaceAll("-", "");
let connectionId = null;
let patientId = null;
let originalCredit = null;
let originalCreditExists = false;
const receiptIds = [];

try {
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email: process.env.PHASE3_OWNER_EMAIL ?? "owner@nhavista.vn" },
    select: { organizationId: true },
  });
  const clinic = await prisma.clinic.findFirstOrThrow({
    where: { organizationId: owner.organizationId },
    select: { id: true },
  });
  const patient = await prisma.patient.findFirstOrThrow({
    where: { organizationId: owner.organizationId, clinicId: clinic.id },
    select: { id: true },
  });
  patientId = patient.id;
  const credit = await prisma.patientCreditBalance.findUnique({
    where: { patientId: patient.id },
    select: { amount: true },
  });
  originalCreditExists = Boolean(credit);
  originalCredit = credit ? Number(credit.amount) : 0;

  const connection = await upsertIntegrationConnection(prisma, {
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    provider: "payos",
    capabilities: { paymentLinks: true, webhooks: true },
    secretRef: "env:PAYOS_CI",
    metadata: { mode: "phase3-smoke" },
  });
  connectionId = connection.id;

  const first = await createOrder({
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    patientId: patient.id,
    connectionId: connection.id,
    orderCode: `${Date.now()}31`,
    amount: 11031,
    suffix: `${suffix}-a`,
  });

  const beforeInvalidInbox = await inboxCount(connection.id);
  const invalidPayload = makePayload(first, {
    reference: `phase3-invalid-${suffix}`,
    transactionCode: "00",
  });
  invalidPayload.signature = "0".repeat(64);
  const invalidResponse = await postWebhook(connection.id, invalidPayload);
  assert(invalidResponse.status === 400, "invalid payOS signature is rejected");
  assert(
    (await inboxCount(connection.id)) === beforeInvalidInbox,
    "invalid payOS signature creates no inbox row",
  );

  const successPayload = makePayload(first, {
    reference: `phase3-first-${suffix}`,
    transactionCode: "00",
  });
  const successResponse = await postWebhook(connection.id, successPayload);
  assert(successResponse.ok, "verified payOS success webhook is accepted");
  const firstRef = await orderReference(owner.organizationId, connection.id, first.orderCode);
  const firstMetadata = referenceMetadata(firstRef);
  assert(firstMetadata.status === "SETTLED", "payOS success settles order");
  assert(typeof firstMetadata.receiptId === "string", "payOS settlement stores receipt reference");
  receiptIds.push(firstMetadata.receiptId);

  const duplicateResponse = await postWebhook(connection.id, successPayload);
  assert(duplicateResponse.ok, "duplicate payOS webhook is idempotent");
  assert(
    await receiptCountByReferences([`phase3-first-${suffix}`]) === 1,
    "duplicate payOS webhook creates one receipt",
  );

  const delayedFailure = makePayload(first, {
    reference: `phase3-late-failure-${suffix}`,
    transactionCode: "01",
  });
  const delayedFailureResponse = await postWebhook(connection.id, delayedFailure);
  assert(delayedFailureResponse.ok, "delayed non-success payOS event is accepted after settlement");
  assert(
    await receiptCountByReferences([`phase3-first-${suffix}`, `phase3-late-failure-${suffix}`]) === 1,
    "delayed/reordered event cannot duplicate settled revenue",
  );
  const firstAfterDelayed = referenceMetadata(
    await orderReference(owner.organizationId, connection.id, first.orderCode),
  );
  assert(firstAfterDelayed.status === "SETTLED", "late event cannot regress settled order");

  const second = await createOrder({
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    patientId: patient.id,
    connectionId: connection.id,
    orderCode: `${Date.now()}32`,
    amount: 12032,
    suffix: `${suffix}-b`,
  });
  const earlyFailure = makePayload(second, {
    reference: `phase3-early-failure-${suffix}`,
    transactionCode: "01",
  });
  assert((await postWebhook(connection.id, earlyFailure)).ok, "early non-success event is recorded");
  assert(
    referenceMetadata(await orderReference(owner.organizationId, connection.id, second.orderCode)).status === "PENDING",
    "early non-success event leaves payment pending",
  );
  const secondSuccess = makePayload(second, {
    reference: `phase3-second-${suffix}`,
    transactionCode: "00",
  });
  assert((await postWebhook(connection.id, secondSuccess)).ok, "later success event settles pending payment");
  const secondMetadata = referenceMetadata(
    await orderReference(owner.organizationId, connection.id, second.orderCode),
  );
  assert(secondMetadata.status === "SETTLED", "reordered success settles exactly once");
  assert(typeof secondMetadata.receiptId === "string", "second settlement stores receipt reference");
  receiptIds.push(secondMetadata.receiptId);

  const third = await createOrder({
    organizationId: owner.organizationId,
    clinicId: clinic.id,
    patientId: patient.id,
    connectionId: connection.id,
    orderCode: `${Date.now()}33`,
    amount: 13033,
    suffix: `${suffix}-c`,
  });
  const wrongAmount = makePayload(
    { ...third, amount: third.amount + 1 },
    { reference: `phase3-wrong-${suffix}`, transactionCode: "00" },
  );
  const mismatchResponse = await postWebhook(connection.id, wrongAmount);
  assert(mismatchResponse.status === 500, "payOS amount mismatch fails processing");
  assert(
    await receiptCountByReferences([`phase3-wrong-${suffix}`]) === 0,
    "amount mismatch cannot mutate revenue",
  );
  const mismatchInbox = await prisma.$queryRawUnsafe(
    `SELECT "status", "lastErrorCode" FROM "IntegrationInbox"
     WHERE "connectionId" = $1 AND "externalEventId" = $2 LIMIT 1`,
    connection.id,
    eventId(wrongAmount),
  );
  assert(mismatchInbox[0]?.status === "RETRY", "failed payOS processing remains retryable");
  assert(mismatchInbox[0]?.lastErrorCode === "payos-amount-mismatch", "retry records stable error code");

  const expectedCredit = originalCredit + first.amount + second.amount;
  const finalCredit = await prisma.patientCreditBalance.findUnique({
    where: { patientId: patient.id },
    select: { amount: true },
  });
  assert(Number(finalCredit?.amount ?? 0) === expectedCredit, "payOS settlement uses canonical patient credit flow");

  console.log("ok phase3 payOS production webhook smoke");
} finally {
  if (connectionId) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM "ExternalReference" WHERE "connectionId" = $1`,
      connectionId,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM "IntegrationInbox" WHERE "connectionId" = $1`,
      connectionId,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM "IntegrationConnection" WHERE "id" = $1`,
      connectionId,
    ).catch(() => {});
  }
  if (receiptIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { entityType: "Receipt", entityId: { in: receiptIds } },
    }).catch(() => {});
    await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } }).catch(() => {});
  }
  if (patientId) {
    if (originalCreditExists) {
      await prisma.patientCreditBalance.update({
        where: { patientId },
        data: { amount: originalCredit },
      }).catch(() => {});
    } else {
      await prisma.patientCreditBalance.deleteMany({ where: { patientId } }).catch(() => {});
    }
  }
  await prisma.$disconnect();
}

async function createOrder(input) {
  await createExternalReference(prisma, {
    organizationId: input.organizationId,
    clinicId: input.clinicId,
    connectionId: input.connectionId,
    provider: "payos",
    entityType: "PAYOS_ORDER",
    internalId: `phase3-order-${input.suffix}`,
    externalId: input.orderCode,
    metadata: {
      patientId: input.patientId,
      clinicId: input.clinicId,
      amount: input.amount,
      invoiceNo: null,
      currency: "VND",
      status: "PENDING",
      paymentLinkId: `link-${input.suffix}`,
    },
  });
  return {
    orderCode: input.orderCode,
    amount: input.amount,
    paymentLinkId: `link-${input.suffix}`,
  };
}

function makePayload(order, input) {
  const data = {
    orderCode: Number(order.orderCode),
    amount: order.amount,
    description: "Phase3 CI",
    reference: input.reference,
    transactionDateTime: "2026-09-02 10:00:00",
    currency: "VND",
    paymentLinkId: order.paymentLinkId,
    code: input.transactionCode,
    desc: input.transactionCode === "00" ? "success" : "pending",
  };
  return {
    code: "00",
    desc: "success",
    success: true,
    data,
    signature: sign(data),
  };
}

function sign(data) {
  const serialized = Object.keys(data)
    .sort()
    .map((key) => `${key}=${data[key] ?? ""}`)
    .join("&");
  return createHmac("sha256", checksumKey).update(serialized).digest("hex");
}

function eventId(payload) {
  const { createHash } = awaitImportCryptoHack();
  return createHash("sha256")
    .update(`${payload.signature.toLowerCase()}:${payload.data.orderCode}`)
    .digest("hex");
}

function awaitImportCryptoHack() {
  return { createHash: (algorithm) => new (requireUnavailable())(algorithm) };
}

async function postWebhook(connectionIdValue, payload) {
  return fetch(`${baseUrl}/api/integrations/payos/webhooks/${connectionIdValue}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function inboxCount(connectionIdValue) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "IntegrationInbox" WHERE "connectionId" = $1`,
    connectionIdValue,
  );
  return Number(rows[0]?.count ?? 0);
}

async function orderReference(organizationId, connectionIdValue, orderCode) {
  return getExternalReferenceByExternalId(prisma, {
    organizationId,
    connectionId: connectionIdValue,
    provider: "payos",
    entityType: "PAYOS_ORDER",
    externalId: String(orderCode),
  });
}

async function receiptCountByReferences(references) {
  return prisma.receipt.count({ where: { reference: { in: references } } });
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase3 payOS smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

function requireUnavailable() {
  throw new Error("unreachable");
}

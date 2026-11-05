const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./audit-source-loader.cjs");

test("payOS authenticates link response and rejects signed mismatched payment identity", async () => {
  let reply;
  const client = load("src/integrations/payos/client.ts", {}, {
    Response, fetch: async () => Response.json(reply),
  });
  const secrets = { clientId: "c", apiKey: "a", checksumKey: "k", baseUrl: "https://merchant.test" };
  const input = { orderCode: 123, amount: 100000, description: "Payment", cancelUrl: "https://app.test/cancel", returnUrl: "https://app.test/return" };
  const data = { orderCode: 123, amount: 100000, currency: "VND", paymentLinkId: "link", checkoutUrl: "https://pay.test/link" };
  reply = { code: "00", data, signature: client.signPayOSData(data, secrets.checksumKey) };
  assert.equal((await client.createPayOSPaymentLink(secrets, input)).paymentLinkId, "link");
  for (const mutation of [{ orderCode: 999 }, { amount: 1 }, { currency: "USD" }]) {
    const wrong = { ...data, ...mutation };
    reply = { code: "00", data: wrong, signature: client.signPayOSData(wrong, secrets.checksumKey) };
    await assert.rejects(client.createPayOSPaymentLink(secrets, input), { code: "payos-payment-link-identity-mismatch" });
  }
  for (const signature of [undefined, "00".repeat(32)]) {
    reply = { code: "00", data, signature };
    await assert.rejects(client.createPayOSPaymentLink(secrets, input), { code: "payos-payment-link-signature-invalid" });
  }
});

test("payOS redelivery receives retryable status until durable inbox processing succeeds", async () => {
  let status = "retry_pending";
  let settlements = 0;
  const record = { id: "ref", clinicId: "clinic", organizationId: "org", metadata: {} };
  const { POST } = load("src/app/api/integrations/payos/webhooks/[connectionId]/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/prisma": { prisma: { $executeRawUnsafe: async () => 1 } },
    "@/infrastructure/integrations/substrate": {
      acceptIntegrationInbox: async () => ({ event: { id: "event" }, duplicate: true }),
      processIntegrationInbox: async () => ({ status }),
    },
    "@/infrastructure/integrations/phase3-store": {
      getIntegrationConnectionById: async () => ({ id: "connection", organizationId: "org", status: "ACTIVE" }),
      getExternalReferenceByExternalId: async () => record,
    },
    "@/lib/application/revenue/provider-settlement": { recordProviderSettlementCommand: async () => { settlements++; } },
    "@/app/api/integrations/payos/connection-secrets": { payOSConnectionSecrets: async () => ({ checksumKey: "key" }) },
  });
  const client = load("src/integrations/payos/client.ts");
  const data = { orderCode: 123, amount: 100000, currency: "VND" };
  const payload = { data, signature: client.signPayOSData(data, "key"), code: "00", success: true };
  for (status of ["retry_pending", "failed", "processed", "already_processed"]) {
    const response = await POST(new Request("https://app.test/webhook", { method: "POST", body: JSON.stringify(payload) }), { params: Promise.resolve({ connectionId: "connection" }) });
    assert.equal(response.status, status === "processed" || status === "already_processed" ? 200 : 503);
    if (response.status === 503) assert.equal(response.headers.get("retry-after"), "5");
  }
  assert.equal(settlements, 0, "The response layer must not manufacture settlements during backoff");
});

function documensoHarness({ completed = false, failStorage = false } = {}) {
  const prisma = { $executeRawUnsafe: async () => 1, $queryRawUnsafe: async () => [{ status: "RETRY" }],
    patientForm: { findFirst: async () => ({ id: "form", patientId: "patient", formNo: "F1" }) } };
  let staged = false;
  let gc = false;
  const reference = { id: "ref", internalId: "form", clinicId: "clinic", metadata: {} };
  const { POST } = load("src/app/api/integrations/documenso/webhooks/[connectionId]/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/prisma": { prisma },
    "@/lib/error-reporting": { reportApplicationError: () => "incident" },
    "@/lib/patient-file-storage": { storePatientUpload: async () => {
      assert.equal(staged, true, "A committed discovery stage must precede object persistence");
      if (failStorage) throw new Error("simulated storage/process interruption");
      return { storageKey: "prefix/file", checksumSha256: "checksum" };
    } },
    "@/infrastructure/patient-files/object-gc": {
      currentPatientFileStorageProvider: () => "local", patientFileStageStoragePrefix: () => "prefix",
      deletePatientFileStageObjects: async () => { throw new Error("cleanup unavailable"); },
    },
    "@/infrastructure/patient-files/staging": {
      createPatientFileStage: async db => { assert.equal(db, prisma, "Stage creation must commit outside the reconciliation transaction"); staged = true; },
      markPatientFileStageStored: async () => undefined,
      markPatientFileStageGcPending: async () => { gc = true; },
    },
    "@/infrastructure/integrations/substrate": {
      acceptIntegrationInbox: async () => ({ event: { id: "event" }, duplicate: true }),
      processIntegrationInbox: async () => ({ status: "retry_pending" }),
    },
    "@/infrastructure/integrations/phase3-store": {
      getIntegrationConnectionById: async () => ({ id: "connection", organizationId: "org", status: "ACTIVE" }),
      getExternalReferenceByExternalId: async () => reference,
      referenceMetadata: value => value.metadata,
    },
    "@/lib/application/forms/provider-signing": { reconcileSignedPatientFormCommand: async () => undefined },
    "@/app/api/integrations/documenso/connection-secrets": { documensoConnectionSecrets: async () => ({ webhookSecret: "secret" }) },
    "@/integrations/documenso/client": {
      verifyDocumensoWebhook: () => ({ event: completed ? "DOCUMENT_COMPLETED" : "DOCUMENT_SENT" }),
      minimalDocumensoWebhookPayload: () => ({ envelopeId: "envelope" }), documensoWebhookEventId: () => "event",
      downloadDocumensoSignedPdf: async () => ({ bytes: Buffer.from("%PDF-test"), fileName: "signed.pdf" }),
    },
  }, { File });
  return { post: () => POST(new Request("https://app.test/webhook", { method: "POST", body: "{}" }), { params: Promise.resolve({ connectionId: "connection" }) }),
    state: () => ({ staged, gc }) };
}

test("Documenso redeliveries preserve retry for both metadata and completed-document paths", async () => {
  for (const completed of [false, true]) {
    const harness = documensoHarness({ completed });
    const response = await harness.post();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    if (completed) assert.deepEqual(harness.state(), { staged: true, gc: true });
  }
});

test("interrupted signed-file upload retains durable cleanup evidence even when object deletion fails", async () => {
  const harness = documensoHarness({ completed: true, failStorage: true });
  const response = await harness.post();
  assert.equal(response.status, 500);
  assert.deepEqual(harness.state(), { staged: true, gc: true });
});

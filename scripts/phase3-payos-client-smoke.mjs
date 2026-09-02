const {
  createPayOSPaymentLink,
  signPayOSData,
  verifyPayOSWebhookPayload,
} = await import("../src/integrations/payos/client.ts");

const originalFetch = globalThis.fetch;
const secrets = {
  clientId: "phase3-client",
  apiKey: "phase3-api-key",
  checksumKey: "phase3-checksum-key",
  baseUrl: "http://payos.test",
};
let capturedBody = null;

try {
  globalThis.fetch = async (url, init = {}) => {
    assert(String(url) === "http://payos.test/v2/payment-requests", "payOS uses v2 payment request endpoint");
    assert(init.headers["x-client-id"] === secrets.clientId, "payOS sends client id header");
    assert(init.headers["x-api-key"] === secrets.apiKey, "payOS sends API key header");
    capturedBody = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        code: "00",
        desc: "success",
        data: {
          orderCode: capturedBody.orderCode,
          amount: capturedBody.amount,
          paymentLinkId: "plink-phase3",
          checkoutUrl: "https://pay.payos.vn/web/plink-phase3",
          qrCode: "000201phase3",
          status: "PENDING",
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const request = {
    orderCode: 260902100001,
    amount: 125000,
    description: "CDX 260902100001",
    cancelUrl: "https://codexdentist.test/billing?payos=cancelled",
    returnUrl: "https://codexdentist.test/billing?payos=returned",
  };
  const link = await createPayOSPaymentLink(secrets, request);
  assert(link.paymentLinkId === "plink-phase3", "payOS payment link response is mapped");
  assert(link.checkoutUrl.startsWith("https://"), "payOS checkout URL is validated");
  const expectedCreateSignature = signPayOSData(
    {
      amount: request.amount,
      cancelUrl: request.cancelUrl,
      description: request.description,
      orderCode: request.orderCode,
      returnUrl: request.returnUrl,
    },
    secrets.checksumKey,
  );
  assert(capturedBody.signature === expectedCreateSignature, "payOS create request uses official signed fields");

  const webhookData = {
    orderCode: request.orderCode,
    amount: request.amount,
    description: request.description,
    reference: "FT260902001",
    transactionDateTime: "2026-09-02 10:00:00",
    currency: "VND",
    paymentLinkId: "plink-phase3",
    code: "00",
    desc: "success",
  };
  const webhook = {
    code: "00",
    desc: "success",
    success: true,
    data: webhookData,
    signature: signPayOSData(webhookData, secrets.checksumKey),
  };
  const verified = verifyPayOSWebhookPayload(webhook, secrets.checksumKey);
  assert(verified.data.orderCode === request.orderCode, "payOS valid webhook signature verifies");

  let tamperedDenied = false;
  try {
    verifyPayOSWebhookPayload(
      { ...webhook, data: { ...webhookData, amount: request.amount + 1 } },
      secrets.checksumKey,
    );
  } catch (error) {
    tamperedDenied = error?.code === "payos-webhook-signature-invalid";
  }
  assert(tamperedDenied, "payOS tampered webhook is rejected");
  console.log("ok phase3 payOS client smoke");
} finally {
  globalThis.fetch = originalFetch;
}

function assert(condition, label) {
  if (!condition) throw new Error(`Phase3 payOS client smoke failed: ${label}`);
  console.log(`ok ${label}`);
}

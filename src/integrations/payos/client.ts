import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type PayOSSecrets = {
  clientId: string;
  apiKey: string;
  checksumKey: string;
  baseUrl: string;
};

export type PayOSPaymentLinkRequest = {
  orderCode: number;
  amount: number;
  description: string;
  cancelUrl: string;
  returnUrl: string;
  expiredAt?: number;
};

export type PayOSPaymentLink = {
  orderCode: number;
  amount: number;
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode: string | null;
  status: string | null;
};

export type PayOSWebhookData = {
  orderCode: number;
  amount: number;
  description?: string;
  accountNumber?: string;
  reference?: string;
  transactionDateTime?: string;
  currency?: string;
  paymentLinkId?: string;
  code?: string;
  desc?: string;
  [key: string]: unknown;
};

export type PayOSWebhookPayload = {
  code: string;
  desc: string;
  success: boolean;
  data: PayOSWebhookData;
  signature: string;
};

export async function createPayOSPaymentLink(
  secrets: PayOSSecrets,
  input: PayOSPaymentLinkRequest,
): Promise<PayOSPaymentLink> {
  assertPositiveInteger(input.orderCode, "payos-order-code-invalid");
  assertPositiveInteger(input.amount, "payos-amount-invalid");

  const payload = {
    orderCode: input.orderCode,
    amount: input.amount,
    description: input.description.slice(0, 25),
    cancelUrl: input.cancelUrl,
    returnUrl: input.returnUrl,
    ...(input.expiredAt ? { expiredAt: input.expiredAt } : {}),
  };
  const signatureData = {
    amount: payload.amount,
    cancelUrl: payload.cancelUrl,
    description: payload.description,
    orderCode: payload.orderCode,
    returnUrl: payload.returnUrl,
  };
  const signature = signPayOSData(signatureData, secrets.checksumKey);
  const response = await fetch(`${secrets.baseUrl}/v2/payment-requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": secrets.clientId,
      "x-api-key": secrets.apiKey,
    },
    body: JSON.stringify({ ...payload, signature }),
    cache: "no-store",
  });
  const body = await safeJson(response);
  if (!response.ok || String(body.code ?? "") !== "00") {
    throw new PayOSProviderError(
      "payos-payment-link-create-failed",
      response.status,
      String(body.desc ?? body.message ?? "payOS request failed"),
    );
  }
  const data = asRecord(body.data);
  const paymentLinkId = requiredString(data.paymentLinkId, "payos-payment-link-id-missing");
  const checkoutUrl = requiredHttpsOrHttpUrl(data.checkoutUrl, "payos-checkout-url-invalid");

  return {
    orderCode: Number(data.orderCode ?? input.orderCode),
    amount: Number(data.amount ?? input.amount),
    paymentLinkId,
    checkoutUrl,
    qrCode: typeof data.qrCode === "string" ? data.qrCode : null,
    status: typeof data.status === "string" ? data.status : null,
  };
}

export function verifyPayOSWebhookPayload(
  payload: unknown,
  checksumKey: string,
): PayOSWebhookPayload {
  const record = asRecord(payload);
  const data = asRecord(record.data) as PayOSWebhookData;
  const signature = requiredString(record.signature, "payos-webhook-signature-missing");
  const expected = signPayOSData(data, checksumKey);
  if (!safeHexEqual(signature, expected)) {
    throw new PayOSProviderError(
      "payos-webhook-signature-invalid",
      400,
      "Invalid payOS webhook signature",
    );
  }
  const orderCode = Number(data.orderCode);
  const amount = Number(data.amount);
  assertPositiveInteger(orderCode, "payos-webhook-order-code-invalid");
  assertPositiveInteger(amount, "payos-webhook-amount-invalid");
  return {
    code: String(record.code ?? ""),
    desc: String(record.desc ?? ""),
    success: record.success === true,
    data: { ...data, orderCode, amount },
    signature,
  };
}

export function payOSWebhookEventId(payload: PayOSWebhookPayload) {
  return createHash("sha256")
    .update(`${payload.signature.toLowerCase()}:${payload.data.orderCode}`)
    .digest("hex");
}

export function minimalPayOSWebhookPayload(payload: PayOSWebhookPayload) {
  return {
    code: payload.code,
    desc: payload.desc,
    success: payload.success,
    orderCode: payload.data.orderCode,
    amount: payload.data.amount,
    currency: typeof payload.data.currency === "string" ? payload.data.currency : "VND",
    reference:
      typeof payload.data.reference === "string" ? payload.data.reference : null,
    transactionDateTime:
      typeof payload.data.transactionDateTime === "string"
        ? payload.data.transactionDateTime
        : null,
    paymentLinkId:
      typeof payload.data.paymentLinkId === "string" ? payload.data.paymentLinkId : null,
    transactionCode:
      typeof payload.data.code === "string" ? payload.data.code : null,
  };
}

export function signPayOSData(
  data: Record<string, unknown>,
  checksumKey: string,
) {
  const serialized = Object.keys(data)
    .sort()
    .filter((key) => data[key] !== undefined)
    .map((key) => `${key}=${payOSValue(data[key])}`)
    .join("&");
  return createHmac("sha256", checksumKey).update(serialized).digest("hex");
}

function payOSValue(value: unknown): string {
  if (value === null || value === undefined || value === "null" || value === "undefined") {
    return "";
  }
  if (Array.isArray(value)) {
    return JSON.stringify(
      value.map((item) =>
        item && typeof item === "object" && !Array.isArray(item)
          ? sortRecord(item as Record<string, unknown>)
          : item,
      ),
    );
  }
  if (value && typeof value === "object") {
    return JSON.stringify(sortRecord(value as Record<string, unknown>));
  }
  return String(value);
}

function sortRecord(record: Record<string, unknown>) {
  return Object.keys(record)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = record[key];
      return result;
    }, {});
}

function safeHexEqual(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function safeJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return asRecord(await response.json());
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function requiredString(value: unknown, code: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new PayOSProviderError(code, 502, code);
  return normalized;
}

function requiredHttpsOrHttpUrl(value: unknown, code: string) {
  const normalized = requiredString(value, code);
  const url = new URL(normalized);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new PayOSProviderError(code, 502, code);
  }
  return url.toString();
}

function assertPositiveInteger(value: number, code: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PayOSProviderError(code, 400, code);
  }
}

export class PayOSProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PayOSProviderError";
  }
}

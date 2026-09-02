import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

export type DocumensoSecrets = {
  apiToken: string;
  webhookSecret: string;
  baseUrl: string;
};

export type DocumensoSigningRequest = {
  externalId: string;
  title: string;
  pdfBytes: Buffer;
  fileName: string;
  recipientEmail: string;
  recipientName: string;
  redirectUrl?: string | null;
};

export type DocumensoSigningEnvelope = {
  envelopeId: string;
  signingUrl: string | null;
};

export type DocumensoWebhookPayload = {
  event: string;
  payload: Record<string, unknown>;
  createdAt?: string | null;
};

export async function createDocumensoSigningEnvelope(
  secrets: DocumensoSecrets,
  input: DocumensoSigningRequest,
): Promise<DocumensoSigningEnvelope> {
  if (!input.pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new DocumensoProviderError(
      "documenso-source-pdf-invalid",
      400,
      "Source document must be a PDF",
    );
  }
  const payload = {
    type: "DOCUMENT",
    title: input.title.slice(0, 160),
    externalId: input.externalId,
    visibility: "MANAGER_AND_ABOVE",
    recipients: [
      {
        email: input.recipientEmail,
        name: input.recipientName,
        role: "SIGNER",
        fields: [
          {
            identifier: 0,
            type: "SIGNATURE",
            page: 1,
            positionX: 10,
            positionY: 82,
            width: 34,
            height: 6,
          },
          {
            identifier: 0,
            type: "DATE",
            page: 1,
            positionX: 55,
            positionY: 82,
            width: 24,
            height: 4,
          },
        ],
      },
    ],
    meta: {
      ...(input.redirectUrl ? { redirectUrl: input.redirectUrl } : {}),
      subject: "Vui lòng ký xác nhận tài liệu",
      message: "Vui lòng xem lại và ký tài liệu được gửi từ phòng khám.",
    },
  };
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append(
    "files",
    new Blob([copyToArrayBuffer(input.pdfBytes)], { type: "application/pdf" }),
    sanitizePdfName(input.fileName),
  );

  const createResponse = await fetch(`${secrets.baseUrl}/envelope/create`, {
    method: "POST",
    headers: { Authorization: secrets.apiToken },
    body: form,
    cache: "no-store",
  });
  const created = await safeJson(createResponse);
  if (!createResponse.ok) {
    throw providerResponseError(
      "documenso-envelope-create-failed",
      createResponse.status,
      created,
    );
  }
  const envelopeId = requiredString(
    created.id ?? created.envelopeId,
    "documenso-envelope-id-missing",
  );

  const distributeResponse = await fetch(`${secrets.baseUrl}/envelope/distribute`, {
    method: "POST",
    headers: {
      Authorization: secrets.apiToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ envelopeId }),
    cache: "no-store",
  });
  const distributed = await safeJson(distributeResponse);
  if (!distributeResponse.ok) {
    throw providerResponseError(
      "documenso-envelope-distribute-failed",
      distributeResponse.status,
      distributed,
    );
  }
  const recipients = Array.isArray(distributed.recipients)
    ? distributed.recipients
    : [];
  const signingUrl = recipients
    .map((recipient) => asRecord(recipient).signingUrl)
    .find((value): value is string => typeof value === "string" && value.length > 0) ?? null;

  return { envelopeId, signingUrl };
}

export function verifyDocumensoWebhook(
  rawPayload: unknown,
  providedSecret: string | null,
  expectedSecret: string,
): DocumensoWebhookPayload {
  if (!providedSecret || !safeTextEqual(providedSecret, expectedSecret)) {
    throw new DocumensoProviderError(
      "documenso-webhook-secret-invalid",
      401,
      "Invalid Documenso webhook secret",
    );
  }
  const record = asRecord(rawPayload);
  const event = requiredString(record.event, "documenso-webhook-event-missing");
  const payload = asRecord(record.payload);
  return {
    event,
    payload,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
  };
}

export function documensoWebhookEventId(payload: DocumensoWebhookPayload) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        event: payload.event,
        payload: deepSort(payload.payload),
        createdAt: payload.createdAt ?? null,
      }),
    )
    .digest("hex");
}

export function minimalDocumensoWebhookPayload(payload: DocumensoWebhookPayload) {
  const source = payload.payload;
  return {
    event: payload.event,
    envelopeId: stringOrNull(source.envelopeId),
    externalId: stringOrNull(source.externalId),
    status: stringOrNull(source.status),
    completedAt: stringOrNull(source.completedAt),
    createdAt: payload.createdAt ?? null,
  };
}

export async function downloadDocumensoSignedPdf(
  secrets: DocumensoSecrets,
  envelopeId: string,
) {
  const envelopeResponse = await fetch(
    `${secrets.baseUrl}/envelope/${encodeURIComponent(envelopeId)}`,
    {
      headers: { Authorization: secrets.apiToken },
      cache: "no-store",
    },
  );
  const envelope = await safeJson(envelopeResponse);
  if (!envelopeResponse.ok) {
    throw providerResponseError(
      "documenso-envelope-fetch-failed",
      envelopeResponse.status,
      envelope,
    );
  }
  if (String(envelope.status ?? "").toUpperCase() !== "COMPLETED") {
    throw new DocumensoProviderError(
      "documenso-envelope-not-completed",
      409,
      "Documenso envelope is not completed",
    );
  }
  const items = Array.isArray(envelope.envelopeItems) ? envelope.envelopeItems : [];
  const itemId = items
    .map((item) => asRecord(item).id)
    .find((value) => typeof value === "string" || typeof value === "number");
  if (itemId === undefined) {
    throw new DocumensoProviderError(
      "documenso-envelope-item-missing",
      502,
      "Completed Documenso envelope has no downloadable item",
    );
  }
  const downloadResponse = await fetch(
    `${secrets.baseUrl}/envelope/item/${encodeURIComponent(String(itemId))}/download?version=signed`,
    {
      headers: { Authorization: secrets.apiToken },
      cache: "no-store",
    },
  );
  if (!downloadResponse.ok) {
    throw new DocumensoProviderError(
      "documenso-signed-pdf-download-failed",
      downloadResponse.status,
      "Unable to download signed Documenso PDF",
    );
  }
  const bytes = Buffer.from(await downloadResponse.arrayBuffer());
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new DocumensoProviderError(
      "documenso-signed-pdf-invalid",
      502,
      "Documenso signed document is not a valid PDF",
    );
  }
  const contentDisposition = downloadResponse.headers.get("content-disposition") ?? "";
  const dispositionName = contentDisposition.match(/filename\*?=(?:UTF-8''|\")?([^";]+)/i)?.[1];
  return {
    bytes,
    fileName: sanitizePdfName(
      dispositionName ? decodeURIComponent(dispositionName) : `${envelopeId}-signed.pdf`,
    ),
  };
}

function copyToArrayBuffer(bytes: Uint8Array) {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function safeTextEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function deepSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepSort);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = deepSort((value as Record<string, unknown>)[key]);
      return result;
    }, {});
}

async function safeJson(response: Response): Promise<Record<string, any>> {
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
  if (!normalized) throw new DocumensoProviderError(code, 502, code);
  return normalized;
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizePdfName(value: string) {
  const decoded = value.replace(/[\\/]/g, "-").trim().slice(0, 120) || "signed.pdf";
  return decoded.toLowerCase().endsWith(".pdf") ? decoded : `${decoded}.pdf`;
}

function providerResponseError(
  code: string,
  status: number,
  body: Record<string, any>,
) {
  return new DocumensoProviderError(
    code,
    status,
    String(body.message ?? body.error ?? body.errorCode ?? code),
  );
}

export class DocumensoProviderError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DocumensoProviderError";
  }
}

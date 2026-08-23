import "server-only";

import type { EInvoiceState } from "./state";

export type EInvoiceProviderInvoice = {
  invoiceId: string;
  invoiceNo: string;
  organizationName: string;
  organizationTaxCode: string | null;
  clinicName: string;
  patientName: string;
  amount: number;
  localStatus: string;
};

export type EInvoiceProviderContext = {
  externalInvoiceId?: string | null;
  lookupCode?: string | null;
};

export type EInvoiceProviderResult = {
  state: Extract<EInvoiceState, "PENDING" | "ISSUED" | "FAILED" | "CANCELLED" | "REPLACED">;
  providerKey: string;
  externalInvoiceId?: string | null;
  lookupCode?: string | null;
  replacementReference?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export interface EInvoiceAdapter {
  readonly providerKey: string;
  issue(invoice: EInvoiceProviderInvoice): Promise<EInvoiceProviderResult>;
  sync(
    invoice: EInvoiceProviderInvoice,
    context: EInvoiceProviderContext,
  ): Promise<EInvoiceProviderResult>;
}

export function resolveEInvoiceAdapter(): EInvoiceAdapter {
  const configured = process.env.EINVOICE_PROVIDER?.trim().toLowerCase();

  if (!configured || configured === "none" || configured === "disabled") {
    return new UnconfiguredEInvoiceAdapter(configured || "unconfigured");
  }

  // Provider-specific adapters should be registered here only after their
  // contract, credentials, idempotency semantics, and callback verification
  // have dedicated tests. Unknown providers fail closed.
  return new UnconfiguredEInvoiceAdapter(configured);
}

class UnconfiguredEInvoiceAdapter implements EInvoiceAdapter {
  readonly providerKey: string;

  constructor(providerKey: string) {
    this.providerKey = providerKey;
  }

  async issue(): Promise<EInvoiceProviderResult> {
    return this.failure();
  }

  async sync(): Promise<EInvoiceProviderResult> {
    return this.failure();
  }

  private failure(): EInvoiceProviderResult {
    return {
      state: "FAILED",
      providerKey: this.providerKey,
      errorCode: "PROVIDER_NOT_CONFIGURED",
      errorMessage:
        "Chưa cấu hình nhà cung cấp hóa đơn điện tử. Không có trạng thái phát hành giả được tạo.",
    };
  }
}

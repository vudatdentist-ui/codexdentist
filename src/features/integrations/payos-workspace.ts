export type PayOSConnectionSummary = {
  id: string; clinicId: string | null; enabled: boolean; configured: boolean;
  verified: boolean; webhookUrl: string; verifiedAt: string | null;
};
export type PayOSSettingsWorkspace = {
  clinics: Array<{ id: string; name: string }>;
  canManageOrganization: boolean; isDemo: boolean; connections: PayOSConnectionSummary[];
};
export type PayOSOrderSummary = {
  id: string; orderCode: number; amount: number; invoiceNo: string | null;
  status: string; checkoutUrl: string | null; qrCode: string | null;
  createdAt: string; updatedAt: string; receiptNo: string | null;
  providerStatus?: string | null; providerAmountPaid?: number | null; providerCheckedAt?: string | null;
};
export type PayOSInvoiceWorkspace = {
  configured: boolean; verified: boolean; connectionId: string | null; orders: PayOSOrderSummary[];
};

export function payOSCheckoutUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function payOSVerificationProbe(payload: {
  success: boolean; data: { orderCode: number; amount: number; reference?: string; paymentLinkId?: string; description?: string };
}) {
  const data = payload.data;
  return payload.success && data.orderCode === 123 && data.amount === 3000 &&
    data.reference === "TF230204212323" && data.description === "VQRIO123" &&
    data.paymentLinkId === "124c33293c43417ab7879e14c8d9eb18";
}

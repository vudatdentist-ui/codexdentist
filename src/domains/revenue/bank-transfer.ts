// NAPAS VietQR format v1.0, section 5 (38/01 is itself a nested template),
// EMVCo Merchant-Presented QR v1.1 section 4.7.3 (CRC 1021, initial FFFF).
// https://vietqr.net/portal-service/download/documents/QR_Format_T%26C_v1.0_VN_092021.pdf
// Pure offline instructions. This module neither verifies a bank account nor moves money.
export const MAX_BANK_TRANSFER_VND = 499_999_999;
export type BankTransferAccount = { bankBin: string; accountNumber: string; recipientName: string };
export class BankTransferError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}
export function bankTransferFail(code: string, status = 400): never { throw new BankTransferError(code, status); }
export function validateBankTransferAccount(value: Record<string, unknown>): BankTransferAccount {
  const { bankBin, accountNumber, recipientName } = value;
  if (typeof bankBin !== "string" || !/^\d{6}$/.test(bankBin) ||
      typeof accountNumber !== "string" || !/^\d{1,19}$/.test(accountNumber) ||
      typeof recipientName !== "string" || recipientName.trim() !== recipientName || !recipientName ||
      /[\p{C}]/u.test(recipientName) || !recipientName.isWellFormed() || new TextEncoder().encode(recipientName).length > 200) {
    bankTransferFail("bank-transfer-account-invalid");
  }
  return { bankBin, accountNumber, recipientName };
}
export function bankTransferTlv(tag: string, value: string) {
  if (!/^\d{2}$/.test(tag) || !value.isWellFormed()) bankTransferFail("bank-transfer-tlv-invalid");
  const length = new TextEncoder().encode(value).length;
  if (length < 1 || length > 99) bankTransferFail("bank-transfer-tlv-invalid");
  return `${tag}${String(length).padStart(2, "0")}${value}`;
}
export function bankTransferCrc(value: string) {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
export function createBankTransferPayload(account: BankTransferAccount, amount: number, memo: string) {
  validateBankTransferAccount(account);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_BANK_TRANSFER_VND) bankTransferFail("bank-transfer-amount-invalid");
  if (!/^[A-Z0-9 ]{1,25}$/.test(memo)) bankTransferFail("bank-transfer-memo-invalid");
  const tlv = bankTransferTlv;
  const beneficiary = tlv("00", account.bankBin) + tlv("01", account.accountNumber);
  const napas = tlv("00", "A000000727") + tlv("01", beneficiary) + tlv("02", "QRIBFTTA");
  const payload = tlv("00", "01") + tlv("01", "12") + tlv("38", napas) + tlv("53", "704") +
    tlv("54", String(amount)) + tlv("58", "VN") + tlv("62", tlv("08", memo)) + "6304";
  return payload + bankTransferCrc(payload);
}

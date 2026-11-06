"use client";
import { useEffect, useId, useRef, useState } from "react";
import type { BankTransferInstructions } from "@/features/integrations/bank-transfer";
import { MAX_BANK_TRANSFER_VND } from "@/domains/revenue/bank-transfer";
import styles from "./PayOSWorkspace.module.css";
type Props = { patientId: string; invoiceNo: string; balance: number; language: "vi" | "en" };
export function BankTransferInvoicePayment(props: Props) {
  return <InvoicePayment key={JSON.stringify([props.patientId, props.invoiceNo, props.balance])} {...props} />;
}
function InvoicePayment({ patientId, invoiceNo, balance, language }: Props) {
  const vi = language === "vi", id = useId(), mounted = useRef(true), inFlight = useRef(false);
  const [amount, setAmount] = useState(String(Math.max(0, Math.min(Math.floor(balance), MAX_BANK_TRANSFER_VND))));
  const [data, setData] = useState<BankTransferInstructions | null>(null), [image, setImage] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const money = (n: number) => `${n.toLocaleString(vi ? "vi-VN" : "en-GB")} ₫`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Instructions are a snapshot, never proof of payment. Expire the display so
  // a long-open tab does not indefinitely present an old amount/account.
  useEffect(() => {
    if (!data) return;
    const timer = setTimeout(() => { setData(null); setImage(""); }, 300000);
    return () => clearTimeout(timer);
  }, [data]);
  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(false); setData(null); setImage("");
    try {
      const response = await fetch("/api/integrations/bank-transfer/qr", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, invoiceNo, amount: Number(amount) }), signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error();
      const value: BankTransferInstructions = await response.json();
      const qr = await import("qrcode");
      const url = await qr.toDataURL(value.payload, { width: 320, margin: 4, errorCorrectionLevel: "M" });
      if (mounted.current) { setData(value); setImage(url); }
    } catch { if (mounted.current) setError(true); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  const valid = /^[1-9]\d{0,8}$/.test(amount) && Number(amount) <= Math.min(balance, MAX_BANK_TRANSFER_VND);
  return <section aria-label={vi ? "QR chuyển khoản" : "Bank transfer QR"} className={styles.panel}>
    <p className={styles.note}>{vi ? "Tạo QR không ghi nhận khoản thu. Đối chiếu giao dịch ngân hàng rồi ghi phiếu thu." : "Creating a QR records no payment. Check the bank transaction before recording a receipt."}</p>
    <label className={styles.field} htmlFor={`${id}-amount`}>{vi ? "Số tiền chuyển (VND)" : "Transfer amount (VND)"}<input id={`${id}-amount`} inputMode="numeric" value={amount} disabled={busy || balance <= 0} onChange={e => { setAmount(e.target.value); setData(null); setImage(""); }} /></label>
    <p className={styles.description}>{vi ? "Còn phải thu: " : "Remaining balance: "}{money(balance)}. {vi ? "Tối đa mỗi QR: " : "Maximum per QR: "}{money(MAX_BANK_TRANSFER_VND)}.</p>
    <button type="button" className={styles.primary} disabled={busy || !valid} onClick={() => void generate()}>{busy ? (vi ? "Đang tạo…" : "Generating…") : (vi ? "Tạo QR chuyển khoản" : "Generate transfer QR")}</button>
    {error && <p role="alert" className={styles.error}>{vi ? "Chưa tạo được QR. Kiểm tra tài khoản nhận tiền trong Cài đặt và tải lại số dư hóa đơn trước khi thử lại." : "Unable to generate QR. Check the receiving account in Settings and refresh the invoice balance before retrying."}</p>}
    {data && <div className={styles.order}>
      <p role="status" className={styles.note}>{vi ? "Hướng dẫn đã tạo; chưa xác nhận thanh toán." : "Instructions generated; payment is unconfirmed."}</p>
      {/* Local data URL only: no bank information is sent to an image service. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} width={320} height={320} style={{ width: "100%", maxWidth: 320, height: "auto", display: "block", margin: "16px auto" }} alt={vi ? "Mã QR hướng dẫn chuyển khoản" : "Bank transfer instructions QR"} />
      <dl className={styles.description} style={{ overflowWrap: "anywhere" }}>
        <dt>{vi ? "Ngân hàng (BIN)" : "Bank BIN"}</dt><dd>{data.bankBin}</dd>
        <dt>{vi ? "Số tài khoản" : "Account number"}</dt><dd>{data.accountNumber}</dd>
        <dt>{vi ? "Người nhận do phòng khám cung cấp" : "Recipient supplied by clinic"}</dt><dd>{data.recipientName}</dd>
        <dt>{vi ? "Số tiền" : "Amount"}</dt><dd>{money(data.amount)}</dd>
        <dt>{vi ? "Nội dung chuyển khoản" : "Transfer memo"}</dt><dd>{data.memo}</dd>
      </dl>
      <p className={styles.description}>{vi ? "Đối chiếu tên người nhận trong ứng dụng ngân hàng trước khi chuyển. Tạo lại QR nếu hóa đơn hoặc tài khoản nhận tiền thay đổi." : "Check the actual recipient name in the banking app before transferring. Generate a fresh QR if the invoice or receiving account changes."}</p>
    </div>}
  </section>;
}

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WorkspaceDialog } from "@/shared/ui/WorkspaceDialog/WorkspaceDialog";
import { payOSCheckoutUrl, type PayOSInvoiceWorkspace, type PayOSOrderSummary } from "@/features/integrations/payos-workspace";
import styles from "./PayOSWorkspace.module.css";

type Props = { patientId: string; invoiceNo: string; balance: number; language: "vi" | "en" };
type Intent = { key: string; amount: number; completed: boolean };
type CreatedOrder = { orderCode: number; paymentLinkId: string; checkoutUrl: string | null; qrCode: string | null; status: string; duplicate: boolean };
const settingsUrl = "/settings?section=providers#payos";

function PaymentCode({ value, vi }: { value: string; vi: boolean }) {
  const [image, setImage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setImage("");
    setFailed(false);
    // Encoding happens on this device; no payment details go to an image service.
    import("qrcode").then(qr => qr.toDataURL(value, { width: 320, margin: 4, errorCorrectionLevel: "M" }))
      .then(url => { if (active) setImage(url); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [value]);
  if (!image) return <p className={styles.description} role="status">{failed
    ? (vi ? "Chưa hiển thị được mã. Hãy mở trang thanh toán bên dưới." : "Could not display the code. Open the payment page below.")
    : (vi ? "Đang tạo mã QR…" : "Preparing QR code…")}</p>;
  // A local data URL is intentional: this QR must never use a remote image host.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.qr} src={image} width={320} height={320} alt={vi ? "Mã QR thanh toán payOS" : "payOS payment QR code"} />;
}

function OrderCard({ order, vi, money, canPay }: { order: PayOSOrderSummary; vi: boolean; money: (value: number) => string; canPay: boolean }) {
  const checkout = payOSCheckoutUrl(order.checkoutUrl);
  const settled = order.status === "SETTLED";
  const pending = ["PENDING", "CREATING", "CREATED", "PROCESSING"].includes(order.status);
  const label = settled ? (vi ? "Đã ghi nhận thanh toán" : "Payment recorded")
    : order.status === "FAILED" ? (vi ? "Không tạo được yêu cầu" : "Request rejected")
    : order.status === "ERROR" ? (vi ? "Cần kiểm tra" : "Needs review")
      : order.status === "CANCELLED" || order.status === "CANCELED" ? (vi ? "Đã hủy" : "Cancelled")
        : order.status === "EXPIRED" ? (vi ? "Đã hết hạn" : "Expired")
          : pending || order.status === "PAID" ? (vi ? "Chờ xác nhận" : "Awaiting confirmation") : (vi ? "Đang kiểm tra" : "Checking status");
  const code = order.qrCode || checkout;
  return <article className={styles.order}>
    <div className={styles.orderTop}>
      <div><strong className={styles.amount}>{money(order.amount)}</strong><p>{vi ? "Yêu cầu" : "Request"} #{order.orderCode}</p></div>
      <span className={`${styles.badge} ${settled ? styles.good : styles.neutral}`}>{label}</span>
    </div>
    {settled && <p className={styles.success}>{order.receiptNo
      ? `${vi ? "Phiếu thu" : "Receipt"}: ${order.receiptNo}`
      : (vi ? "Đã nhận xác nhận. Tải lại để xem phiếu thu." : "Confirmation received. Refresh to view the receipt.")}</p>}
    {pending && code && canPay && <PaymentCode value={code} vi={vi} />}
    {pending && checkout && canPay && <a href={checkout} target="_blank" rel="noopener noreferrer">{vi ? "Mở trang thanh toán payOS" : "Open payOS payment page"} ↗</a>}
    {pending && !canPay && <p className={styles.description}>{vi ? "Hóa đơn không còn khoản cần thu. Không sử dụng mã thanh toán trước đó." : "This invoice has no balance due. Do not use its earlier payment code."}</p>}
    {pending && !code && <p className={styles.description}>{vi ? "Chưa có mã thanh toán. Vui lòng tải lại trạng thái." : "The payment code is not available yet. Refresh the status."}</p>}
    {order.status === "ERROR" && <p className={styles.description}>{vi ? "Chưa ghi nhận khoản thu. Tải lại trạng thái trước khi tạo yêu cầu khác." : "No receipt has been recorded. Refresh the status before creating another request."}</p>}
  </article>;
}

export function PayOSInvoicePayment(props: Props) {
  // Switching invoices must discard the previous invoice's view and request intent.
  return <InvoicePayment key={JSON.stringify([props.patientId, props.invoiceNo])} {...props} />;
}

function InvoicePayment({ patientId, invoiceNo, balance, language }: Props) {
  const vi = language === "vi";
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<PayOSInvoiceWorkspace | null>(null);
  const [amount, setAmount] = useState(() => Number.isSafeInteger(balance) && balance > 0 ? String(balance) : "");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const [created, setCreated] = useState<PayOSOrderSummary | null>(null);
  const busy = useRef(false);
  const intentRef = useRef<Intent | null>(null);
  const readSequence = useRef(0);
  const settlements = useRef(new Map<string, string | null>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; readSequence.current += 1; }; }, []);
  const money = (value: number) => new Intl.NumberFormat(vi ? "vi-VN" : "en-US", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(value);

  const load = useCallback(async () => {
    const sequence = ++readSequence.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ patientId, invoiceNo });
      const response = await fetch(`/api/integrations/payos/payment-links?${query}`, { cache: "no-store", signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("load");
      const data: PayOSInvoiceWorkspace = await response.json();
      if (!mounted.current || sequence !== readSequence.current) return;
      setWorkspace(data);
      let changed = false;
      for (const order of data.orders) {
        if (order.status !== "SETTLED") continue;
        if (!settlements.current.has(order.id) || settlements.current.get(order.id) !== order.receiptNo) changed = true;
        settlements.current.set(order.id, order.receiptNo);
      }
      if (changed) router.refresh();
    } catch {
      if (mounted.current && sequence === readSequence.current) setError(vi ? "Chưa tải được trạng thái thanh toán. Vui lòng thử lại." : "Could not load payment status. Please retry.");
    } finally {
      if (mounted.current && sequence === readSequence.current) setLoading(false);
    }
  }, [patientId, invoiceNo, router, vi]);

  useEffect(() => { if (open && !busy.current) void load(); }, [open, load]);
  const parsedAmount = Number(amount);
  const validAmount = /^\d+$/.test(amount) && Number.isSafeInteger(parsedAmount) && parsedAmount > 0 && parsedAmount <= balance;
  const canCreate = !!workspace?.configured && workspace.verified && validAmount && !loading && !pending && !intent?.completed;
  const orders = [...(workspace?.orders ?? [])];
  if (created && !orders.some(order => order.orderCode === created.orderCode)) orders.unshift(created);

  async function create() {
    if (busy.current || !canCreate) return;
    // The same intent survives a timeout, an uncertain response and dialog close.
    // Only the explicit "New request" action below discards it.
    let current = intentRef.current;
    if (!current) {
      try { current = { key: crypto.randomUUID(), amount: parsedAmount, completed: false }; }
      catch { setError(vi ? "Chưa thể tạo yêu cầu an toàn. Vui lòng tải lại trang." : "Could not prepare a secure request. Please reload the page."); return; }
      intentRef.current = current;
      setIntent(current);
    }
    if (current.completed || current.amount !== parsedAmount) return;
    busy.current = true;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/integrations/payos/payment-links", {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ patientId, invoiceNo, amount: current.amount, idempotencyKey: current.key }),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        if (mounted.current && detail?.error === "payos-invoice-amount-invalid") {
          setError(vi ? "Số dư hóa đơn đã thay đổi. Tải lại hóa đơn trước khi tạo yêu cầu mới." : "The invoice balance changed. Refresh the invoice before creating another request.");
          router.refresh(); return;
        }
        if (mounted.current) setError(response.status === 403
          ? (vi ? "Bạn chưa có quyền tạo yêu cầu thanh toán này." : "You do not have permission to create this payment request.")
          : response.status === 400 || response.status === 422
            ? (vi ? "Kiểm tra số tiền và kết nối payOS rồi thử lại." : "Check the amount and payOS connection, then retry.")
            : response.status === 409
              ? (vi ? "Yêu cầu đang được kiểm tra. Tải lại trạng thái hoặc thử lại cùng yêu cầu." : "This request is being checked. Refresh the status or retry the same request.")
              : (vi ? "Chưa xác nhận được yêu cầu. Tải lại trạng thái hoặc thử lại cùng yêu cầu." : "The request could not be confirmed. Refresh the status or retry the same request."));
        return;
      }
      const data: CreatedOrder = await response.json();
      if (!Number.isSafeInteger(data.orderCode) || typeof data.status !== "string") throw new Error("response");
      if (!mounted.current) return;
      const completed = { ...current, completed: true };
      intentRef.current = completed;
      setIntent(completed);
      setCreated({ id: `created-${data.orderCode}`, orderCode: data.orderCode, amount: current.amount, invoiceNo, status: data.status,
        checkoutUrl: payOSCheckoutUrl(data.checkoutUrl), qrCode: typeof data.qrCode === "string" ? data.qrCode : null,
        receiptNo: null, createdAt: "", updatedAt: "" });
      setNotice(data.duplicate ? (vi ? "Đã tìm thấy yêu cầu trước đó." : "Your existing request was found.") : (vi ? "Đã tạo yêu cầu thanh toán." : "Payment request created."));
      await load();
    } catch {
      if (mounted.current) setError(vi ? "Chưa nhận được xác nhận. Thử lại sẽ tiếp tục cùng yêu cầu; hãy kiểm tra lịch sử trước khi tạo yêu cầu khác." : "No confirmation received. Retry continues the same request; check the history before starting another.");
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <>
    <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>{vi ? "Thanh toán payOS" : "payOS payment"}</button>
    <WorkspaceDialog open={open} onClose={() => setOpen(false)} title={vi ? "Thanh toán qua payOS" : "Pay with payOS"} closeLabel={vi ? "Đóng" : "Close"} className={styles.dialog}>
      <div className={styles.payment} aria-busy={loading || pending}>
        <div className={styles.invoice}><span>{vi ? "Hóa đơn" : "Invoice"}: <strong>{invoiceNo}</strong></span><span>{vi ? "Còn phải thu" : "Balance due"}: <strong>{money(balance)}</strong></span></div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        {notice && <p className={styles.success} role="status">{notice}</p>}
        {loading && <p role="status">{vi ? "Đang tải trạng thái…" : "Loading status…"}</p>}
        <div className={styles.actions}><button type="button" className={styles.secondary} disabled={loading || pending} onClick={() => void load()}>{vi ? "Tải lại trạng thái" : "Refresh status"}</button></div>
        {workspace && (!workspace.configured || !workspace.verified) && <p className={styles.note}>
          {!workspace.configured ? (vi ? "Chưa thiết lập payOS cho phòng khám. " : "payOS has not been set up for this clinic. ") : (vi ? "Cần xác minh kết nối trước khi tạo yêu cầu. " : "Verify the connection before creating a request. ")}
          <a href={settingsUrl}>{vi ? "Thiết lập payOS" : "Set up payOS"}</a>
        </p>}
        {workspace?.configured && workspace.verified && <div>
          <label className={styles.field} htmlFor={`${id}-amount`}><span>{vi ? "Số tiền thanh toán (VND)" : "Payment amount (VND)"}</span>
            <input id={`${id}-amount`} type="number" inputMode="numeric" min={1} max={Math.max(0, balance)} step={1} value={amount} disabled={pending || !!intent} aria-describedby={`${id}-amount-help`} onChange={event => setAmount(event.target.value)} />
          </label>
          <p id={`${id}-amount-help`} className={styles.description}>{balance <= 0 ? (vi ? "Hóa đơn không còn số dư cần thu." : "This invoice has no balance due.")
            : !validAmount ? (vi ? "Nhập số nguyên dương, không vượt quá số dư hóa đơn." : "Enter a positive whole amount up to the invoice balance.")
              : (vi ? "Chỉ ghi nhận khoản thu sau khi nhận xác nhận thanh toán." : "A receipt is recorded only after payment is confirmed.")}</p>
          {intent && !intent.completed && <p className={styles.note}>{vi ? "Yêu cầu chưa được xác nhận. Thử lại giữ nguyên số tiền và yêu cầu này." : "This request is not confirmed yet. Retry keeps the same amount and request."}</p>}
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={!canCreate} onClick={() => void create()}>{pending ? (vi ? "Đang tạo yêu cầu…" : "Creating request…") : intent && !intent.completed ? (vi ? "Thử lại cùng yêu cầu" : "Retry same request") : (vi ? "Tạo mã thanh toán" : "Create payment code")}</button>
            {intent && <button type="button" className={styles.secondary} disabled={pending || loading} onClick={() => { intentRef.current = null; setIntent(null); setNotice(""); setError(""); }}>{vi ? "Tạo yêu cầu khác" : "New payment request"}</button>}
          </div>
          {intent && !intent.completed && <p className={styles.description}>{vi ? "Chỉ chọn “Tạo yêu cầu khác” khi chủ động thu khoản mới. Yêu cầu trước có thể vẫn đang chờ thanh toán." : "Choose “New payment request” only for an intentional new collection. The previous request may still be awaiting payment."}</p>}
        </div>}
        <h3 className={styles.historyHeading}>{vi ? "Lịch sử yêu cầu" : "Payment requests"}</h3>
        {orders.length > 0 ? <ul className={styles.history}>{orders.map(order => <li key={order.id}><OrderCard order={order} vi={vi} money={money} canPay={balance > 0} /></li>)}</ul>
          : !loading && <p className={styles.description}>{vi ? "Chưa có yêu cầu thanh toán." : "No payment requests yet."}</p>}
      </div>
    </WorkspaceDialog>
  </>;
}

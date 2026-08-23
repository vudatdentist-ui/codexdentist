import Link from "next/link";
import {
  confirmExternalEInvoiceAction,
  confirmExternalEInvoiceCancellationAction,
  confirmExternalEInvoiceReplacementAction,
  markEInvoiceNotRequiredAction,
  requestEInvoiceIssueAction,
  syncEInvoiceAction,
} from "@/features/einvoice/server/actions";
import type {
  FinanceInvoiceRow,
  FinanceOperationsIssue,
  FinanceOperationsModel,
} from "@/features/finance/server/get-finance-operations";
import { WorkspaceChrome } from "@/features/navigation/ui/WorkspaceChrome";
import { formatVnd } from "@/lib/data";
import { canAccessView } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import styles from "./finance-workspace.module.css";

export function FinanceWorkspace({
  model,
  notice,
  session,
}: {
  model: FinanceOperationsModel;
  notice: string | null;
  session: AppSession;
}) {
  return (
    <WorkspaceChrome activeWorkspace="operations" contextLabel="Tài chính" session={session}>
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>Tài chính</h1>
            <span>Thu tiền → hóa đơn → HĐĐT → đối soát</span>
          </div>
          <Link className={styles.primaryAction} href="/billing">
            Thu tiền / xuất hóa đơn <span aria-hidden="true">→</span>
          </Link>
        </header>

        <nav aria-label="Vận hành" className={styles.subnav}>
          <span aria-current="page">Tài chính</span>
          {canAccessView(session, "reports") && <Link href="/operations">Nhân sự</Link>}
          {canAccessView(session, "inventory") && <Link href="/inventory">Kho</Link>}
          {canAccessView(session, "reports") && <Link href="/reports">Báo cáo</Link>}
        </nav>

        {(notice || model.message) && <p className={styles.notice}>{notice ?? model.message}</p>}

        <div className={styles.statusLine} aria-label="Trạng thái tài chính">
          <Fact label="Thu hôm nay" value={formatVnd(model.summary.collectionsToday)} />
          <Fact label="Còn phải thu" value={formatVnd(model.summary.outstandingBalance)} />
          <Fact label="Thu chưa phân bổ" value={formatVnd(model.summary.unallocatedReceipts)} />
          <Fact label="Đã thu chưa hóa đơn" value={formatVnd(model.summary.uninvoicedCollections)} />
          <Fact label="HĐĐT lỗi" value={`${model.summary.eInvoiceFailed}`} />
          <Fact label="HĐĐT đang chờ" value={`${model.summary.eInvoicePending}`} />
        </div>

        <IssueSection issues={model.issues} />

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Hóa đơn & HĐĐT</h2>
              <span>{model.invoices.length}</span>
            </div>
            <span>HĐĐT là trạng thái độc lập với ledger nội bộ</span>
          </div>

          {model.invoices.length > 0 ? (
            <div className={styles.invoiceTable} role="table" aria-label="Hóa đơn và HĐĐT">
              <div className={`${styles.invoiceRow} ${styles.tableHeader}`} role="row">
                <span role="columnheader">Hóa đơn</span>
                <span role="columnheader">Bệnh nhân</span>
                <span role="columnheader">Tổng / đã thu</span>
                <span role="columnheader">HĐĐT</span>
                <span role="columnheader">Đối soát</span>
                <span role="columnheader">Hành động</span>
              </div>
              {model.invoices.map((invoice) => (
                <InvoiceRow invoice={invoice} key={invoice.id} />
              ))}
            </div>
          ) : (
            <p className={styles.empty}>Chưa có hóa đơn trong phạm vi hiện tại.</p>
          )}
        </section>

        <div className={styles.twoColumn}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Phiếu thu chưa phân bổ</h2>
                <span>{model.receipts.filter((receipt) => receipt.unallocatedAmount > 0.5).length}</span>
              </div>
              <Link href="/billing">Mở Billing</Link>
            </div>
            <div className={styles.compactRows}>
              {model.receipts
                .filter((receipt) => receipt.unallocatedAmount > 0.5)
                .slice(0, 12)
                .map((receipt) => (
                  <div className={styles.compactRow} key={receipt.id}>
                    <div>
                      <strong>{receipt.receiptNo}</strong>
                      <span>{receipt.patientName} · {receipt.receivedAt}</span>
                    </div>
                    <div className={styles.rowEnd}>
                      <strong>{formatVnd(receipt.unallocatedAmount)}</strong>
                      <Link href={`/billing?patientId=${encodeURIComponent(receipt.patientId)}`}>Phân bổ →</Link>
                    </div>
                  </div>
                ))}
              {model.receipts.every((receipt) => receipt.unallocatedAmount <= 0.5) && (
                <p className={styles.empty}>Không có phiếu thu chưa phân bổ.</p>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Đã thu chưa xuất hóa đơn</h2>
                <span>{model.services.filter((service) => service.uninvoicedCollectedAmount > 0.5).length}</span>
              </div>
            </div>
            <div className={styles.compactRows}>
              {model.services
                .filter((service) => service.uninvoicedCollectedAmount > 0.5)
                .slice(0, 12)
                .map((service) => (
                  <div className={styles.compactRow} key={service.id}>
                    <div>
                      <strong>{service.serviceCode} · {service.serviceName}</strong>
                      <span>{service.patientName} · {service.progressPercent}%</span>
                    </div>
                    <div className={styles.rowEnd}>
                      <strong>{formatVnd(service.uninvoicedCollectedAmount)}</strong>
                      <Link href={`/patients/${encodeURIComponent(service.patientId)}/treatments/${encodeURIComponent(service.id)}`}>Ca điều trị →</Link>
                    </div>
                  </div>
                ))}
              {model.services.every((service) => service.uninvoicedCollectedAmount <= 0.5) && (
                <p className={styles.empty}>Không có khoản đã thu đang chờ hóa đơn.</p>
              )}
            </div>
          </section>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Thu tiền gần đây</h2>
              <span>{model.receipts.length}</span>
            </div>
          </div>
          <div className={styles.receiptRows}>
            {model.receipts.slice(0, 16).map((receipt) => (
              <div className={styles.receiptRow} key={receipt.id}>
                <div>
                  <strong>{receipt.receiptNo}</strong>
                  <span>{receipt.receivedAt} · {receipt.clinicName}</span>
                </div>
                <div>
                  <strong>{receipt.patientName}</strong>
                  <span>{receipt.method}{receipt.reference ? ` · ${receipt.reference}` : ""}</span>
                </div>
                <span>{formatVnd(receipt.allocatedAmount)} phân bổ</span>
                <strong>{formatVnd(receipt.amount)}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </WorkspaceChrome>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.fact}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function IssueSection({ issues }: { issues: FinanceOperationsIssue[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Cần xử lý</h2>
          <span>{issues.length}</span>
        </div>
        <Link href="/work">Mở Công việc</Link>
      </div>
      {issues.length > 0 ? (
        <div className={styles.issueRows}>
          {issues.slice(0, 14).map((issue) => (
            <article className={styles.issueRow} key={issue.id}>
              <span className={`${styles.priority} ${styles[issue.priority]}`} />
              <div>
                <strong>{issue.title}</strong>
                <span>{issue.detail}</span>
              </div>
              <span>{issue.clinicName ?? "Toàn hệ thống"}</span>
              <Link href={issue.href}>Xử lý →</Link>
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>Không có sai lệch tài chính cần xử lý.</p>
      )}
    </section>
  );
}

function InvoiceRow({ invoice }: { invoice: FinanceInvoiceRow }) {
  const canRequest = invoice.status !== "VOID" && invoice.eInvoice.state !== "ISSUED" && invoice.eInvoice.state !== "REPLACED";
  const canSync = invoice.eInvoice.state === "FAILED" || invoice.eInvoice.state === "PENDING";
  const needsExternalCancellation = invoice.status === "VOID" && (invoice.eInvoice.state === "ISSUED" || invoice.eInvoice.state === "REPLACED");

  return (
    <div className={styles.invoiceRow} id={`invoice-${invoice.id}`} role="row">
      <div className={styles.invoiceIdentity} role="cell">
        <strong>{invoice.invoiceNo}</strong>
        <span>{invoice.status} · {invoice.createdAt}</span>
      </div>
      <div role="cell">
        <strong>{invoice.patientName}</strong>
        <span>{invoice.treatmentServiceCode ?? invoice.clinicName}</span>
      </div>
      <div role="cell">
        <strong>{formatVnd(invoice.amount)}</strong>
        <span>{formatVnd(invoice.paidAmount)} đã thu</span>
      </div>
      <div role="cell">
        <State state={invoice.eInvoice.state} />
        <span>{invoice.eInvoice.externalInvoiceId ?? invoice.eInvoice.errorCode ?? "Chưa có external ref"}</span>
      </div>
      <div role="cell">
        <State state={invoice.reconciliation} />
        <span>{invoice.balance > 0 ? `${formatVnd(invoice.balance)} còn phải thu` : "Ledger đã cân theo số dư"}</span>
      </div>
      <div className={styles.actions} role="cell">
        {canRequest && (
          <form action={requestEInvoiceIssueAction}>
            <input name="invoiceId" type="hidden" value={invoice.id} />
            <button type="submit">Yêu cầu HĐĐT</button>
          </form>
        )}
        {canSync && (
          <form action={syncEInvoiceAction}>
            <input name="invoiceId" type="hidden" value={invoice.id} />
            <button type="submit">Đồng bộ lại</button>
          </form>
        )}
        {needsExternalCancellation && (
          <form action={confirmExternalEInvoiceCancellationAction}>
            <input name="invoiceId" type="hidden" value={invoice.id} />
            <button type="submit">Xác nhận đã hủy HĐĐT</button>
          </form>
        )}
        <details className={styles.moreActions}>
          <summary>Đối soát…</summary>
          <div className={styles.actionPopover}>
            {invoice.status !== "VOID" && invoice.eInvoice.state !== "ISSUED" && invoice.eInvoice.state !== "REPLACED" && (
              <form action={confirmExternalEInvoiceAction}>
                <input name="invoiceId" type="hidden" value={invoice.id} />
                <label>
                  <span>Mã HĐĐT ngoài hệ thống</span>
                  <input name="externalInvoiceId" required />
                </label>
                <label>
                  <span>Mã tra cứu</span>
                  <input name="lookupCode" />
                </label>
                <label>
                  <span>Nhà cung cấp</span>
                  <input defaultValue="external-manual" name="providerKey" />
                </label>
                <button type="submit">Xác nhận đã phát hành</button>
              </form>
            )}

            {(invoice.eInvoice.state === "ISSUED" || invoice.eInvoice.state === "REPLACED") && invoice.status !== "VOID" && (
              <form action={confirmExternalEInvoiceReplacementAction}>
                <input name="invoiceId" type="hidden" value={invoice.id} />
                <label>
                  <span>Mã HĐĐT thay thế</span>
                  <input name="externalInvoiceId" required />
                </label>
                <label>
                  <span>Tham chiếu thay thế</span>
                  <input name="replacementReference" required />
                </label>
                <label>
                  <span>Mã tra cứu</span>
                  <input name="lookupCode" />
                </label>
                <button type="submit">Ghi nhận thay thế</button>
              </form>
            )}

            {invoice.eInvoice.state !== "ISSUED" && invoice.eInvoice.state !== "REPLACED" && (
              <form action={markEInvoiceNotRequiredAction}>
                <input name="invoiceId" type="hidden" value={invoice.id} />
                <button type="submit">Đánh dấu không yêu cầu HĐĐT</button>
              </form>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

function State({ state }: { state: string }) {
  const labels: Record<string, string> = {
    NOT_REQUIRED: "Chưa yêu cầu",
    PENDING: "Đang chờ",
    ISSUED: "Đã phát hành",
    FAILED: "Lỗi",
    CANCELLED: "Đã hủy",
    REPLACED: "Đã thay thế",
    MATCHED: "Khớp",
    NEEDS_ACTION: "Cần xử lý",
    MISMATCH: "Sai lệch",
  };
  return <span className={`${styles.state} ${styles[`state${state}`] ?? ""}`}>{labels[state] ?? state}</span>;
}

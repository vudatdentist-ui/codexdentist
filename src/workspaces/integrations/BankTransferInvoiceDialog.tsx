"use client";
import { useState } from "react";
import { WorkspaceDialog } from "@/shared/ui/WorkspaceDialog/WorkspaceDialog";
import { BankTransferInvoicePayment } from "./BankTransferInvoicePayment";
import styles from "./PayOSWorkspace.module.css";
type Props = { patientId: string; invoiceNo: string; balance: number; language: "vi" | "en" };
export function BankTransferInvoiceDialog(props: Props) {
  return <InvoiceDialog key={JSON.stringify([props.patientId, props.invoiceNo, props.balance])} {...props} />;
}
function InvoiceDialog(props: Props) {
  const [open, setOpen] = useState(false), vi = props.language === "vi";
  return <>
    <button type="button" className={styles.secondary} disabled={props.balance <= 0} onClick={() => setOpen(true)}>
      {vi ? "QR chuyển khoản" : "Bank transfer QR"}</button>
    <WorkspaceDialog open={open} onClose={() => setOpen(false)} title={vi ? "Hướng dẫn chuyển khoản" : "Bank transfer instructions"}
      closeLabel={vi ? "Đóng" : "Close"} className={styles.dialog}>
      {open && <BankTransferInvoicePayment {...props} />}
    </WorkspaceDialog>
  </>;
}

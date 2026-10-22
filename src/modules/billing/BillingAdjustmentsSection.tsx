"use client";
import { Bell, CreditCard, WalletCards } from "lucide-react";
import { adjustInvoiceAmountAction, createPaymentPlanAction, recordInvoiceRefundAction, } from "@/app/(app)/billing/actions";
import { MoneyInput } from "@/components/MoneyInput";
import { PanelHeader } from "@/components/suite-primitives";
import { receiptMethodLabel, } from "./billing-shared";
import type { BillingPanelModel } from "./billing-model";
export function BillingAdjustmentsSection(model: Pick<BillingPanelModel, "bt" | "billingAdvancedLabels" | "canMutate" | "adjustableInvoices" | "refundableInvoices" | "language" | "visiblePaymentPlans" | "formReady" | "formPatients" | "dueDate">) {
    const { bt, billingAdvancedLabels, canMutate, adjustableInvoices, refundableInvoices, language, visiblePaymentPlans, formReady, formPatients, dueDate } = model;
    return (<details className="billing-admin-details">
          <summary>{bt.advancedTools}</summary>
          <div className="content-grid service-management-grid">
            <section className="panel">
            <PanelHeader icon={CreditCard} title={billingAdvancedLabels.adjustment} action={billingAdvancedLabels.audit}/>
            <form action={adjustInvoiceAmountAction} className="staff-form" onSubmit={(event) => {
            if (!window.confirm(billingAdvancedLabels.confirmAdjust)) {
                event.preventDefault();
            }
        }}>
              <label>
                {bt.invoiceList}
                <select name="invoiceNo" disabled={!canMutate || adjustableInvoices.length === 0} required>
                  {adjustableInvoices.map((invoice) => (<option value={invoice.id} key={invoice.id}>
                      {invoice.id} - {invoice.patient}
                    </option>))}
                </select>
              </label>
              <label>
                {billingAdvancedLabels.amountNew}
                <MoneyInput name="amount" disabled={!canMutate} required/>
              </label>
              <label className="clinical-wide">
                {billingAdvancedLabels.reason}
                <textarea name="reason" disabled={!canMutate}/>
              </label>
              <button className="primary-button" type="submit" disabled={!canMutate || adjustableInvoices.length === 0}>
                {billingAdvancedLabels.adjustment}
              </button>
            </form>
            </section>

            <section className="panel">
            <PanelHeader icon={WalletCards} title={billingAdvancedLabels.refund} action={billingAdvancedLabels.ledger}/>
            <form action={recordInvoiceRefundAction} className="staff-form" onSubmit={(event) => {
            if (!window.confirm(billingAdvancedLabels.confirmRefund)) {
                event.preventDefault();
            }
        }}>
              <label>
                {bt.invoiceList}
                <select name="invoiceNo" disabled={!canMutate || refundableInvoices.length === 0} required>
                  {refundableInvoices.map((invoice) => (<option value={invoice.id} key={invoice.id}>
                      {invoice.id} - {invoice.patient}
                    </option>))}
                </select>
              </label>
              <label>
                {billingAdvancedLabels.refundAmount}
                <MoneyInput name="amount" disabled={!canMutate} required/>
              </label>
              <label>
                {bt.collectionMethod}
                <select name="method" defaultValue="cash" disabled={!canMutate}>
                  <option value="cash">{receiptMethodLabel("cash", language)}</option>
                  <option value="card">{receiptMethodLabel("card", language)}</option>
                  <option value="bank_transfer">{receiptMethodLabel("bank_transfer", language)}</option>
                </select>
              </label>
              <input name="reference" placeholder={billingAdvancedLabels.reason} disabled={!canMutate}/>
              <button className="primary-button" type="submit" disabled={!canMutate || refundableInvoices.length === 0}>
                {billingAdvancedLabels.refund}
              </button>
            </form>
            </section>

            <section className="panel">
            <PanelHeader icon={Bell} title={billingAdvancedLabels.paymentPlan} action={`${visiblePaymentPlans.length}`}/>
            <form action={createPaymentPlanAction} className="staff-form">
              <label>
                {bt.patient}
                <select name="patientId" disabled={!formReady} required>
                  {formPatients.map((patient) => (<option value={patient.id} key={patient.id}>
                      {patient.name}
                    </option>))}
                </select>
              </label>
              <label>
                {bt.amountTotal}
                <MoneyInput name="amount" disabled={!formReady} required/>
              </label>
              <label>
                {billingAdvancedLabels.firstDueAt}
                <input name="firstDueAt" type="date" defaultValue={dueDate} disabled={!formReady}/>
              </label>
              <label>
                {billingAdvancedLabels.installmentCount}
                <input name="installmentCount" inputMode="numeric" defaultValue="3" disabled={!formReady}/>
              </label>
              <label>
                {billingAdvancedLabels.intervalDays}
                <input name="intervalDays" inputMode="numeric" defaultValue="30" disabled={!formReady}/>
              </label>
              <label className="clinical-wide">
                {billingAdvancedLabels.reason}
                <textarea name="note" disabled={!formReady}/>
              </label>
              <button className="primary-button" type="submit" disabled={!formReady}>
                {billingAdvancedLabels.paymentPlan}
              </button>
            </form>
            </section>
          </div>
        </details>);
}

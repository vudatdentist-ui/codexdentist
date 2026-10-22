"use client";
import { Download, Printer, WalletCards } from "lucide-react";
import Link from "next/link";
import { recordPaymentAction, voidInvoiceAction } from "@/app/(app)/billing/actions";
import { MoneyInput } from "@/components/MoneyInput";
import { EmptyState, } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { StatusPill, isCollectableInvoice, receiptMethodLabel, displayServiceInstanceCode } from "./billing-shared";
import type { BillingPanelModel } from "./billing-model";
export function BillingInvoicesSection(model: Pick<BillingPanelModel, "bt" | "filteredInvoices" | "journeyInvoiceIds" | "journeyServicesById" | "journeyServicesByInvoiceId" | "journeyServiceInvoiceSnapshot" | "serviceCollectedAmount" | "billingInvoiceAmount" | "billingInvoicePaidAmount" | "billingInvoiceBalance" | "canMutate" | "visiblePatientsById" | "dueDate" | "language" | "billingAdvancedLabels">) {
    const { bt, filteredInvoices, journeyInvoiceIds, journeyServicesById, journeyServiceInvoiceSnapshot, serviceCollectedAmount, billingInvoiceAmount, billingInvoicePaidAmount, billingInvoiceBalance, canMutate, visiblePatientsById, language, billingAdvancedLabels, } = model;
    return (<section className="panel">
        <div className="panel-header">
          <div>
            <WalletCards size={18} aria-hidden="true"/>
            <strong>{bt.invoiceList}</strong>
          </div>
          <a className="panel-action-link" href="/billing/export">
            <Download size={14} aria-hidden="true"/>
            {bt.exportCsv}
          </a>
        </div>
        <div className="invoice-list">
          {filteredInvoices.length > 0 ? (filteredInvoices.map((invoice) => {
            const isJourneyInvoice = journeyInvoiceIds.has(invoice.id);
            const relatedService = (invoice.serviceId ? journeyServicesById.get(invoice.serviceId) : undefined) ??
                (undefined);
            const invoiceSnapshot = relatedService
                ? journeyServiceInvoiceSnapshot(relatedService, invoice)
                : undefined;
            const relatedServiceCollected = relatedService
                ? serviceCollectedAmount(relatedService.id)
                : 0;
            const relatedServiceUnapplied = relatedService && invoiceSnapshot?.isLatestInvoice
                ? Math.max(relatedServiceCollected - relatedService.finalPrice, 0)
                : 0;
            const displayedInvoiceAmount = billingInvoiceAmount(invoice);
            const displayedServiceAmount = relatedService?.finalPrice ?? displayedInvoiceAmount;
            const displayedPaidAmount = relatedService
                ? invoiceSnapshot?.paidThroughInvoice ?? 0
                : billingInvoicePaidAmount(invoice);
            const displayedBalance = relatedService
                ? invoiceSnapshot?.balanceAfterInvoice ?? 0
                : billingInvoiceBalance(invoice);
            const canChangeInvoice = (canMutate || isJourneyInvoice) && isCollectableInvoice(invoice);
            return (<div className="invoice-row billing-invoice-row" key={invoice.id}>
                <div>
                  <strong>{invoice.id}</strong>
                  <span>
                    {relatedService
                    ? `${displayServiceInstanceCode(relatedService, visiblePatientsById.get(relatedService.patientId))} · `
                    : ""}
                    {invoice.patient}
                    {""}
                  </span>
                </div>
                <div className="billing-invoice-cell">
                  <span>{bt.dueDate}</span>
                  <strong>{invoice.due}</strong>
                </div>
                <div className="billing-invoice-cell">
                  <span>{bt.amountTotal}</span>
                  <strong>{formatVnd(displayedServiceAmount)}</strong>
                  {relatedService && (<small className="billing-credit-note">
                      {bt.invoiceThisTime}: {formatVnd(displayedInvoiceAmount)}
                    </small>)}
                </div>
                <div className="billing-invoice-cell">
                  <span>{relatedService ? bt.paidThroughInvoice : bt.amountPaid}</span>
                  <strong>{formatVnd(displayedPaidAmount)}</strong>
                </div>
                <div className="billing-invoice-cell">
                  <span>{relatedService ? bt.remainingAfterInvoice : bt.balance}</span>
                  <strong>{formatVnd(displayedBalance)}</strong>
                  {relatedServiceUnapplied > 0 && (<small className="billing-credit-note">
                      {bt.creditBalance}: {formatVnd(relatedServiceUnapplied)}
                    </small>)}
                </div>
                <StatusPill status={invoice.status}/>
                <div className="invoice-actions">
                  {(<Link href={`/billing/print/${encodeURIComponent(invoice.id)}`}>
                      <Printer size={13} aria-hidden="true"/>
                      {bt.print}
                    </Link>)}
                  {canChangeInvoice && (<>
                      {(<form action={recordPaymentAction}>
                          <input name="invoiceNo" type="hidden" value={invoice.id}/>
                          <MoneyInput name="amount" placeholder={bt.paidAmount} required/>
                          <select name="method" defaultValue="cash">
                            <option value="cash">
                              {receiptMethodLabel("cash", language)}
                            </option>
                            <option value="card">
                              {receiptMethodLabel("card", language)}
                            </option>
                            <option value="bank_transfer">
                              {receiptMethodLabel("bank_transfer", language)}
                            </option>
                          </select>
                          <button type="submit">{bt.recordPayment}</button>
                        </form>)}
                      {(<form action={voidInvoiceAction} onSubmit={(event) => {
                            if (!window.confirm(billingAdvancedLabels.confirmVoid)) {
                                event.preventDefault();
                            }
                        }}>
                          <input name="invoiceNo" type="hidden" value={invoice.id}/>
                          <button className="danger-link" type="submit">
                            {bt.cancel}
                          </button>
                        </form>)}
                    </>)}
                </div>
              </div>);
        })) : (<EmptyState label={bt.emptyInvoices}/>)}
        </div>
      </section>);
}

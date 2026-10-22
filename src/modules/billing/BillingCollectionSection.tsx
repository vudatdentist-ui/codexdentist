"use client";
import { WalletCards } from "lucide-react";
import { issueServiceInvoiceAction, recordServiceReceiptAction, recordServiceReceiptAndInvoiceAction } from "@/app/(app)/billing/actions";
import { MoneyInput } from "@/components/MoneyInput";
import { EmptyState, PanelHeader } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { displayStatus, StatusPill, JourneyCollectionMethod, serviceProgressPercent, serviceProgressIsCancelled, displayServiceInstanceCode } from "./billing-shared";
import type { BillingPanelModel } from "./billing-model";
export function BillingCollectionSection(model: Pick<BillingPanelModel, "bt" | "filteredJourneyServices" | "periodJourneyServices" | "journeyFilterOptions" | "journeyServiceFilter" | "setJourneyServiceFilter" | "visiblePatientsById" | "activeServiceInvoices" | "serviceInvoicedAmount" | "serviceUninvoicedAmount" | "serviceCreditAllocationAmount" | "serviceAppliedAmount" | "serviceRemainingInvoiceCapacity" | "receiptDrafts" | "unappliedReceiptTotal" | "language" | "billingInvoiceAmount" | "billingAdvancedLabels" | "updateReceiptDraft" | "canMutate">) {
    const { bt, filteredJourneyServices, periodJourneyServices, journeyFilterOptions, journeyServiceFilter, setJourneyServiceFilter, visiblePatientsById, activeServiceInvoices, serviceInvoicedAmount, serviceUninvoicedAmount, serviceCreditAllocationAmount, serviceAppliedAmount, serviceRemainingInvoiceCapacity, receiptDrafts, unappliedReceiptTotal, language, billingInvoiceAmount, billingAdvancedLabels, updateReceiptDraft, canMutate, } = model;
    return (<section className="panel">
        <PanelHeader icon={WalletCards} title={bt.collectionTitle} action={`${filteredJourneyServices.length}/${periodJourneyServices.length}`}/>
        <div className="segmented billing-service-filters" role="group" aria-label={bt.collectionTitle}>
          {journeyFilterOptions.map((option) => (<button className={journeyServiceFilter === option.filter ? "active" : ""} type="button" key={option.filter} onClick={() => setJourneyServiceFilter(option.filter)}>
              {option.label} <span>{option.count}</span>
            </button>))}
        </div>
        <div className="journey-billing-list">
          {filteredJourneyServices.length > 0 ? (filteredJourneyServices.map((service) => {
            const patient = visiblePatientsById.get(service.patientId);
            const serviceInvoices = activeServiceInvoices(service.id);
            const invoicedAmount = serviceInvoicedAmount(service.id);
            const uninvoicedAmount = serviceUninvoicedAmount(service);
            const creditAppliedAmount = serviceCreditAllocationAmount(service.id);
            const appliedAmount = serviceAppliedAmount(service.id);
            const remainingAmount = Math.max(service.finalPrice - appliedAmount, 0);
            const remainingInvoiceCapacity = serviceRemainingInvoiceCapacity(service);
            const progressPercent = serviceProgressPercent(service.progress);
            const collectedPercent = service.finalPrice > 0
                ? Math.min(Math.round((appliedAmount / service.finalPrice) * 100), 100)
                : 0;
            const isPlannedDeposit = progressPercent <= 0 &&
                !serviceProgressIsCancelled(service.progress) &&
                appliedAmount > 0;
            const receiptDraft = receiptDrafts[service.id] ?? {
                amount: "",
                method: "cash" as JourneyCollectionMethod,
            };
            const serviceAllocationFromBalance = service.source === "database";
            const isCreditMethod = serviceAllocationFromBalance || receiptDraft.method === "credit_balance";
            const receiptDraftAmount = Math.max(Number(receiptDraft.amount) || 0, 0);
            const actionDisabled = isCreditMethod
                ? unappliedReceiptTotal <= 0 || remainingAmount <= 0
                : receiptDraftAmount <= 0;
            const recordAndInvoiceDisabled = actionDisabled || remainingInvoiceCapacity <= 0;
            const serviceState = serviceProgressIsCancelled(service.progress)
                ? displayStatus("Cancelled", language)
                : isPlannedDeposit
                    ? bt.filterDeposit
                    : remainingAmount <= 0
                        ? bt.complete
                        : progressPercent > 0
                            ? bt.serviceReady
                            : bt.depositAllowed;
            const serviceStateClass = serviceProgressIsCancelled(service.progress)
                ? "cancelled"
                : isPlannedDeposit
                    ? "waiting"
                    : remainingAmount <= 0
                        ? "settled"
                        : progressPercent > 0
                            ? "action"
                            : "waiting";
            const displayedInvoiceLabel = serviceInvoices.length > 0
                ? `${serviceInvoices.length} ${bt.invoiceCount} · ${formatVnd(invoicedAmount)} / ${formatVnd(service.finalPrice)}`
                : bt.noInvoice;
            const invoiceActionLabel = uninvoicedAmount > 0
                ? bt.issueMissingInvoice
                : invoicedAmount >= service.finalPrice
                    ? bt.invoiceComplete
                    : bt.waitingForMoreCollection;
            return (<article className="journey-billing-item" key={service.id}>
                  <div className="journey-billing-head">
                    <div>
                      <strong>{service.serviceName}</strong>
                      <span>
                        {displayServiceInstanceCode(service, patient)} ·{" "}
                        {patient?.name ?? service.patientId} · {service.object}
                      </span>
                    </div>
                    <div className="billing-service-badges">
                      <span className={`billing-service-state ${serviceStateClass}`}>
                        {serviceState}
                      </span>
                      <StatusPill status={service.progress}/>
                    </div>
                  </div>
                  <div className="journey-billing-stats">
                    <span>
                      <small>{bt.amountTotal}</small>
                      <strong>{formatVnd(service.finalPrice)}</strong>
                    </span>
                    <span>
                      <small>{bt.amountPaid}</small>
                      <strong>{formatVnd(appliedAmount)}</strong>
                      {creditAppliedAmount > 0 && (<small className="billing-credit-note">
                          {bt.creditApplied}: {formatVnd(creditAppliedAmount)}
                        </small>)}
                    </span>
                    <span>
                      <small>{bt.amountDue}</small>
                      <strong>{formatVnd(remainingAmount)}</strong>
                    </span>
                    <span>
                      <small>{bt.invoiceStatus}</small>
                      <strong>{displayedInvoiceLabel}</strong>
                    </span>
                  </div>
                  {serviceInvoices.length > 0 && (<div className="billing-service-invoice-list">
                      {serviceInvoices.map((invoice) => (<span key={invoice.id}>
                          <strong>{invoice.id}</strong>
                          {formatVnd(billingInvoiceAmount(invoice))} ·{" "}
                          {displayStatus(invoice.status, language)}
                        </span>))}
                    </div>)}
                  <div className="billing-service-progress">
                    <span>
                      <i style={{ width: `${collectedPercent}%` }}/>
                    </span>
                    <small>
                      {bt.collected}: {collectedPercent}% · {bt.progress}: {progressPercent}%
                    </small>
                  </div>
                  {(<form action={recordServiceReceiptAction} className="journey-billing-controls" onSubmit={(event) => {
                        const submitter = (event.nativeEvent as SubmitEvent)
                            .submitter as HTMLButtonElement | null;
                        const actionKind = submitter?.dataset.actionKind ?? "receipt";
                        const message = actionKind === "receipt_and_invoice"
                            ? billingAdvancedLabels.confirmReceiptAndInvoice
                            : actionKind === "issue_invoice"
                                ? billingAdvancedLabels.confirmIssueInvoice
                                : billingAdvancedLabels.confirmReceipt;
                        if (!window.confirm(message)) {
                            event.preventDefault();
                        }
                    }}>
                      <input name="treatmentServiceId" type="hidden" value={service.id}/>
                      <input name="method" type="hidden" value="credit_balance"/>
                      <MoneyInput aria-label={bt.collectionAmount} name="amount" value={receiptDraft.amount} onValueChange={(amount) => updateReceiptDraft(service.id, { amount })} placeholder={isCreditMethod ? bt.allocationAmount : bt.collectionAmount}/>
                      <button className="secondary-button" type="submit" data-action-kind="receipt" value="receipt" disabled={!canMutate || actionDisabled}>
                        {bt.allocateFromBalance}
                      </button>
                      <button className="primary-button" type="submit" data-action-kind="receipt_and_invoice" value="receipt_and_invoice" formAction={recordServiceReceiptAndInvoiceAction} disabled={!canMutate || recordAndInvoiceDisabled}>
                        {bt.allocateAndInvoiceFromBalance}
                      </button>
                      <button className="secondary-button" type="submit" data-action-kind="issue_invoice" value="issue_invoice" formAction={issueServiceInvoiceAction} disabled={!canMutate || uninvoicedAmount <= 0}>
                        {invoiceActionLabel}
                      </button>
                    </form>)}
                </article>);
        })) : (<EmptyState label={bt.emptyServices}/>)}
        </div>
      </section>);
}

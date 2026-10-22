"use client";
import { Bell, CreditCard, FileText, WalletCards } from "lucide-react";
import { EmptyState, PanelHeader, RecordTile } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { displayStatus, statementKindLabel, statementBalanceLabel, patientCodeFor, } from "./billing-shared";
import type { BillingPanelModel } from "./billing-model";
export function BillingBalancesSection(model: Pick<BillingPanelModel, "bt" | "unappliedReceiptTotal" | "activeCreditBalances" | "visiblePatientsById" | "billingAdvancedLabels" | "visibleStatementLines" | "language" | "creditBalanceAllocationReceipts" | "visiblePaymentPlans" | "visiblePaymentPlanReminders">) {
    const { bt, unappliedReceiptTotal, activeCreditBalances, visiblePatientsById, billingAdvancedLabels, visibleStatementLines, language, creditBalanceAllocationReceipts, visiblePaymentPlans, visiblePaymentPlanReminders } = model;
    return (<section className="content-grid service-management-grid">
          <section className="panel">
            <PanelHeader icon={CreditCard} title={bt.unappliedBalance} action={formatVnd(unappliedReceiptTotal)}/>
            <div className="record-grid">
              {activeCreditBalances.length > 0 ? (activeCreditBalances.map((balance) => {
            const patient = visiblePatientsById.get(balance.patientId);
            return (<RecordTile key={balance.patientId} title={patient ? `${patientCodeFor(patient)} · ${patient.name}` : balance.patientId} value={formatVnd(balance.amount)}/>);
        })) : (<EmptyState label={bt.noUnappliedBalance}/>)}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={FileText} title={billingAdvancedLabels.statement} action={`${visibleStatementLines.length}`}/>
            <div className="invoice-list">
              {visibleStatementLines.length > 0 ? (visibleStatementLines.slice(-14).reverse().map((line) => (<div className="invoice-row billing-invoice-row" key={line.id}>
                    <div>
                      <strong>{line.patientName}</strong>
                      <span>
                        {statementKindLabel(line.kind, language)} · {line.description}
                      </span>
                      <small>{line.date}</small>
                    </div>
                    <div className="billing-invoice-cell">
                      <span>{bt.statementDebit}</span>
                      <strong>{line.debit > 0 ? formatVnd(line.debit) : "-"}</strong>
                    </div>
                    <div className="billing-invoice-cell">
                      <span>{bt.statementCredit}</span>
                      <strong>{line.credit > 0 ? formatVnd(line.credit) : "-"}</strong>
                    </div>
                    <div className="billing-invoice-cell">
                      <span>{bt.balance}</span>
                      <strong>{statementBalanceLabel(line.balanceAfter, language)}</strong>
                    </div>
                  </div>))) : (<EmptyState label={bt.emptyInvoices}/>)}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={WalletCards} title={bt.creditAllocationHistory} action={`${creditBalanceAllocationReceipts.length}`}/>
            <div className="record-grid">
              {creditBalanceAllocationReceipts.length > 0 ? (creditBalanceAllocationReceipts.slice(0, 12).map((receipt) => (<RecordTile key={receipt.id} title={`${receipt.receiptNo} · ${receipt.patientName}`} value={`${formatVnd(receipt.amount)} · ${bt.creditApplied} · ${receipt.receivedAt}`}/>))) : (<EmptyState label={bt.noUnappliedBalance}/>)}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={WalletCards} title={billingAdvancedLabels.paymentPlanList} action={`${visiblePaymentPlans.length}`}/>
            <div className="invoice-list">
              {visiblePaymentPlans.length > 0 ? (visiblePaymentPlans.slice(0, 8).map((plan) => (<div className="invoice-row billing-invoice-row" key={plan.id}>
                    <div>
                      <strong>{plan.planNo} · {plan.patientName}</strong>
                      <span>{formatVnd(plan.totalAmount)} · {displayStatus(plan.status, language)}</span>
                      <small>{plan.note ?? plan.createdAt}</small>
                    </div>
                    <div className="record-grid">
                      {plan.installments.slice(0, 4).map((installment) => (<RecordTile key={installment.id} title={`${installment.sequence}. ${installment.dueAt}`} value={`${formatVnd(installment.amount)} · ${displayStatus(installment.status, language)}`}/>))}
                    </div>
                  </div>))) : (<EmptyState label={billingAdvancedLabels.paymentPlanList}/>)}
            </div>
          </section>

          <section className="panel">
            <PanelHeader icon={Bell} title={billingAdvancedLabels.paymentPlan} action={`${visiblePaymentPlanReminders.length}`}/>
            <div className="record-grid">
              {visiblePaymentPlanReminders.length > 0 ? (visiblePaymentPlanReminders.slice(0, 12).map((reminder) => (<RecordTile key={reminder.id} title={`${reminder.patientName ?? reminder.recipient} · ${reminder.scheduledAt ?? "-"}`} value={`${reminder.amount ? formatVnd(reminder.amount) : "-"} · ${displayStatus(reminder.status, language)}`}/>))) : (<EmptyState label={billingAdvancedLabels.paymentPlan}/>)}
            </div>
          </section>
        </section>);
}

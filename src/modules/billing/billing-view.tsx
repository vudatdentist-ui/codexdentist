"use client";
import { BillingCollectionSection } from "./BillingCollectionSection";
import { BillingAdjustmentsSection } from "./BillingAdjustmentsSection";
import { BillingInvoicesSection } from "./BillingInvoicesSection";
import { BillingBalancesSection } from "./BillingBalancesSection";
import { WorkspaceTabs } from "@/components/ui/WorkspaceControls";
import { FileText, UsersRound, WalletCards } from "lucide-react";
import { createInvoiceAction, recordPatientReceiptAction, } from "@/app/(app)/billing/actions";
import { MoneyInput } from "@/components/MoneyInput";
import { EmptyState, MetricCard, PanelHeader, RecordTile } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { BillingPeriodFilter, BillingInvoiceFilter, workspaceMessageText, isJourneyCollectionMethod, collectionMethodLabel, patientCodeFor, } from "./billing-shared";
import type { BillingPanelModel } from "./billing-model";
export function BillingPanelView(model: BillingPanelModel) {
    const { billingWorkspace, visibleClinics, language, bt, notice, canMutate, billingClinicFilter, setBillingClinicFilter, billingPeriodFilter, setBillingPeriodFilter, billingInvoiceFilter, setBillingInvoiceFilter, billingSection, setBillingSection, selectBillingPatient, billingClinicOptions, periodAppointments, scopedBillingPatients, selectedBillingPatient, formPatients, formReady, dueDate, invoiceFilterOptions, openTotal, allocatedTotal, issuedInvoiceTotal, overdueInvoices, overdueInvoiceTotal, plannedDepositServices, plannedDepositTotal, recentDatabaseReceipts, selectedBillingPatientBalanceAmount, selectedBillingPatientDirectReceiptTotal, patientBillingRows, billingAdvancedLabels, remainingJourneyTotal, billingResultScopeActive, billingSearchSummary, billingSectionOptions, billingPeriodOptions, billingClinicLabel, billingTimeLabel } = model;
    return (<section className="view-stack">
      <div className="workspace-actions">
        <div>


          {bt.subtitle ? <p className="billing-subtitle">{bt.subtitle}</p> : null}
        </div>

      </div>

      {billingSearchSummary ? (<div className="chart-search-meta billing-search-meta">
          <span>{billingSearchSummary}</span>
        </div>) : null}

      <div className="billing-operational-filters">
        <label>
          {billingClinicLabel}
          <select value={billingClinicFilter} onChange={(event) => setBillingClinicFilter(event.target.value)}>
            <option value="all">
              {language === "vi" ? "Tất cả chi nhánh" : "All clinics"}
            </option>
            {billingClinicOptions.map((clinic) => (<option value={clinic.id} key={clinic.id}>
                {clinic.name}
              </option>))}
          </select>
        </label>
        <label>
          {billingTimeLabel}
          <select value={billingPeriodFilter} onChange={(event) => setBillingPeriodFilter(event.target.value as BillingPeriodFilter)}>
            {billingPeriodOptions.map((option) => (<option value={option.value} key={option.value}>
                {option.label}
              </option>))}
          </select>
        </label>
        <label>
          {language === "vi" ? "Hóa đơn" : "Invoice"}
          <select value={billingInvoiceFilter} onChange={(event) => setBillingInvoiceFilter(event.target.value as BillingInvoiceFilter)}>
            {invoiceFilterOptions.map((option) => (<option value={option.filter} key={option.filter}>
                {option.label} ({option.count})
              </option>))}
          </select>
        </label>
        <span>
          {language === "vi"
            ? `${periodAppointments.length} lịch hẹn, ${scopedBillingPatients.length} bệnh nhân`
            : `${periodAppointments.length} appointments, ${scopedBillingPatients.length} patients`}
        </span>
      </div>

      {(billingWorkspace?.message || notice) && (<div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(billingWorkspace?.message, language)}
        </div>)}

      {bt.alert ? <div className="schedule-alert billing-rule-note">{bt.alert}</div> : null}

      {!selectedBillingPatient && (<section className="panel billing-patient-worklist">
          <PanelHeader icon={UsersRound} title={bt.patientBillingList} action={`${patientBillingRows.length}/${scopedBillingPatients.length}`}/>
          <div className="billing-patient-list">
            {patientBillingRows.length > 0 ? (patientBillingRows.map((row) => (<button className="billing-patient-card" key={row.patient.id} onClick={() => {
                    selectBillingPatient(row.patient.id);
                    setBillingSection("collection");
                }} type="button">
                  <div>
                    <strong>{row.patient.name}</strong>
                    <span>
                      {patientCodeFor(row.patient)} ·{" "}
                      {visibleClinics.find((clinic) => clinic.id === row.patient.clinicId)
                    ?.name ?? row.patient.city}
                    </span>
                  </div>
                  <div>
                    <small>{bt.serviceTitle}</small>
                    <strong>{row.progressedServices.length}</strong>
                  </div>
                  <div>
                    <small>{bt.minimumDue}</small>
                    <strong>{formatVnd(row.minimumDueAmount)}</strong>
                  </div>
                  <div>
                    <small>{bt.amountPaid}</small>
                    <strong>{formatVnd(row.paidAmount)}</strong>
                  </div>
                  <div>
                    <small>{bt.amountDue}</small>
                    <strong>{formatVnd(row.dueAmount)}</strong>
                  </div>
                  <div>
                    <small>{bt.creditBalance}</small>
                    <strong>{formatVnd(row.creditBalance)}</strong>
                  </div>
                  <span>{bt.openPatientBilling}</span>
                </button>))) : (<EmptyState label={bt.patientBillingEmpty}/>)}
          </div>
        </section>)}

      {selectedBillingPatient && (<>
      <div className="billing-selected-patient-bar">
        <button className="secondary-button" onClick={() => selectBillingPatient("")} type="button">
          {bt.backToPatients}
        </button>
        <div>
          <strong>{selectedBillingPatient.name}</strong>
          <span>
            {patientCodeFor(selectedBillingPatient)} · {selectedBillingPatient.phone}
          </span>
        </div>
      </div>

      <section className="panel billing-patient-balance-panel">
        <PanelHeader icon={WalletCards} title={bt.patientBalanceTitle} action={formatVnd(selectedBillingPatientBalanceAmount)}/>
        <div className="record-grid">
          <RecordTile title={bt.receiptTotal} value={formatVnd(selectedBillingPatientDirectReceiptTotal)}/>
          <RecordTile title={bt.allocatedTotal} value={formatVnd(allocatedTotal)}/>
          <RecordTile title={bt.amountDue} value={formatVnd(remainingJourneyTotal)}/>
        </div>
        <form action={recordPatientReceiptAction} className="billing-balance-form">
          <input name="patientId" type="hidden" value={selectedBillingPatient.id}/>
          <label>
            {bt.patientReceiptTitle}
            <MoneyInput name="amount" placeholder={bt.collectionAmount} required/>
          </label>
          <label>
            {bt.collectionMethod}
            <select name="method" defaultValue="cash" required>
              <option value="cash">{collectionMethodLabel("cash", language)}</option>
              <option value="card">{collectionMethodLabel("card", language)}</option>
              <option value="bank_transfer">
                {collectionMethodLabel("bank_transfer", language)}
              </option>
            </select>
          </label>
          <label>{billingAdvancedLabels.reason}<input name="reference" placeholder={billingAdvancedLabels.reason}/></label>
          <button className="primary-button" type="submit" disabled={!canMutate}>
            {bt.recordReceiptOnly}
          </button>
        </form>
      </section>

      <p className="billing-metric-scope">
        {billingResultScopeActive ? bt.metricScopeFiltered : bt.metricScopeAll}
      </p>

      <div className="metric-grid billing-metric-grid">
        <MetricCard label={bt.invoiceTotal} value={formatVnd(issuedInvoiceTotal)} tone="teal"/>
        <MetricCard label={bt.openBalances} value={formatVnd(openTotal)} tone="amber"/>
        <MetricCard label={bt.overdueInvoices} value={`${overdueInvoices.length} · ${formatVnd(overdueInvoiceTotal)}`} tone="rose"/>
        <MetricCard label={bt.plannedDeposits} value={`${plannedDepositServices.length} · ${formatVnd(plannedDepositTotal)}`} tone="blue"/>
      </div>

      <WorkspaceTabs className="segmented billing-workbench-tabs" role="tablist" aria-label={bt.workflow}>
        {billingSectionOptions.map((option) => (<button aria-selected={billingSection === option.key} className={billingSection === option.key ? "active" : ""} key={option.key} onClick={() => setBillingSection(option.key)} role="tab" type="button">
            {option.label} <span>{option.count}</span>
          </button>))}
      </WorkspaceTabs>

      {billingSection === "collection" && (<BillingCollectionSection {...model}/>)}

      {billingSection === "invoices" && (<>
      <details className="billing-admin-details billing-manual-details">
        <summary>{bt.manualInvoice}</summary>
        <div className="billing-manual-details-body">
          <div className="panel-header">
            <div>
              <FileText size={18} aria-hidden="true"/>
              <strong>{bt.manualInvoice}</strong>
            </div>
            <span className="billing-admin-action-label">{bt.createInvoice}</span>
          </div>
          <p className="billing-panel-note">{bt.manualInvoiceHint}</p>
          <form action={createInvoiceAction} className="billing-form">
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
              <MoneyInput name="amount" placeholder="9.800.000" disabled={!formReady} required/>
            </label>
            <label>
              {bt.dueDate}
              <input name="dueDate" type="date" defaultValue={dueDate} disabled={!formReady}/>
            </label>
            <button className="primary-button" type="submit" disabled={!formReady}>
              <WalletCards size={16}/>
              {bt.createInvoice}
            </button>
          </form>
        </div>
      </details>
      </>)}

      {billingSection === "control" && billingWorkspace?.source === "database" && (<BillingAdjustmentsSection {...model}/>)}

      {billingSection === "invoices" && (<>
      <BillingInvoicesSection {...model}/>
      </>)}

      {billingSection === "receipts" && billingWorkspace?.source === "database" && (<section className="content-grid service-management-grid">
          <section className="panel">
            <PanelHeader icon={WalletCards} title={bt.recentReceipts} action={`${recentDatabaseReceipts.length}`}/>
            <div className="record-grid">
              {recentDatabaseReceipts.length > 0 ? (recentDatabaseReceipts.map((receipt) => (<RecordTile key={receipt.id} title={`${receipt.receiptNo} · ${receipt.patientName}`} value={`${formatVnd(receipt.amount)} · ${isJourneyCollectionMethod(receipt.method)
                        ? collectionMethodLabel(receipt.method, language)
                        : receipt.method} · ${receipt.receivedAt}`}/>))) : (<EmptyState label={bt.noReceipts}/>)}
            </div>
          </section>
        </section>)}

      {billingSection === "balances" && billingWorkspace?.source === "database" && (<BillingBalancesSection {...model}/>)}
      </>)}
    </section>);
}

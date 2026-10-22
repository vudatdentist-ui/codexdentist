"use client";
import { Archive, Bell, Building2, MessageSquareText, ShieldCheck, WalletCards } from "lucide-react";
import Link from "next/link";
import { createChairAction, createClinicAction, createOrganizationAction, createSourceCommissionPolicyAction, generateSourceCommissionAccrualsAction, sendNotificationTestAction, toggleClinicStatusAction, toggleChairStatusAction, toggleSourceCommissionPolicyAction, updateSourceCommissionAccrualStatusAction, updateClinicAction, updateChairAction, } from "@/app/(app)/settings/actions";
import { EmptyState, PanelHeader, RecordTile } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { displayStatus, StatusPill } from "./settings-shared";
import type { SettingsPanelModel } from "./settings-model";
export function OrganizationSettingsSection(model: Pick<SettingsPanelModel, "accountLabels" | "organizations" | "canManageSystems" | "canMutate" | "formClinics" | "text" | "chairLabels" | "confirmText" | "archiveResultCount" | "settingsArchiveSearch" | "setSettingsArchiveSearch" | "filteredArchivedClinics" | "sourceCommission" | "sourceCommissionTotal" | "leadSourceOptions" | "language" | "notificationSettings" | "notificationMode" | "notificationReadiness" | "filteredAiRuns" | "aiRuns" | "aiProviderReadiness" | "aiSettings" | "aiAuditQuery" | "setAiAuditQuery" | "aiAuditModule" | "setAiAuditModule" | "aiAuditModules" | "aiAuditStatus" | "setAiAuditStatus">) {
    const { accountLabels, organizations, canManageSystems, canMutate, formClinics, text, chairLabels, confirmText, archiveResultCount, settingsArchiveSearch, setSettingsArchiveSearch, filteredArchivedClinics, sourceCommission, sourceCommissionTotal, leadSourceOptions, language, notificationSettings, notificationReadiness, filteredAiRuns, aiRuns, aiProviderReadiness, aiSettings, aiAuditQuery, setAiAuditQuery, aiAuditModule, setAiAuditModule, aiAuditModules, aiAuditStatus, setAiAuditStatus } = model;
    return (<aside className="settings-side-stack">
          <section className="panel" data-settings-block="organization">
            <PanelHeader icon={Building2} title={accountLabels.systemScope} action={`${organizations.length}`}/>
            <div className="settings-clinic-list">
              {canManageSystems && (<form action={createOrganizationAction} className="settings-clinic-form">
                  <input name="name" placeholder={accountLabels.organizationName} disabled={!canMutate} required/>
                  <input name="slug" placeholder={accountLabels.tenantSlug} disabled={!canMutate} pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" minLength={3} maxLength={40} required/>
                  <input name="ownerFullName" placeholder={accountLabels.ownerFullName} disabled={!canMutate} required/>
                  <input name="ownerEmail" type="email" placeholder={accountLabels.ownerEmail} disabled={!canMutate} required/>
                  <small className="settings-form-hint">{accountLabels.tenantSlugHint}</small>
                  <button type="submit" disabled={!canMutate}>
                    {accountLabels.addOrganization}
                  </button>
                </form>)}
              {organizations.map((organization) => (<article className="settings-archive-row" key={organization.id}>
                  <div className="settings-archive-head">
                    <div>
                      <strong>{organization.name}</strong>
                      <span>{organization.primaryDomain ?? "-"}</span>
                    </div>
                    <StatusPill status={organization.slug ? "ACTIVE" : "PENDING"}/>
                  </div>
                  <div className="settings-archive-counts">
                    <span>{accountLabels.tenantSlug}: {organization.slug ?? "-"}</span>
                    <span>{accountLabels.staffAccounts}: {organization.userCount}</span>
                    <span>{accountLabels.activeOwners}: {organization.ownerCount}</span>
                    <span>{accountLabels.visibleClinics}: {organization.clinicCount}</span>
                  </div>
                </article>))}
            </div>
          </section>

          <section className="panel" data-settings-block="organization">
            <PanelHeader icon={Building2} title={accountLabels.clinicScope} action={`${formClinics.length}`}/>
            <div className="settings-clinic-list">
              <form action={createClinicAction} className="settings-clinic-form">
                {canManageSystems && (<select name="organizationId" disabled={!canMutate} required>
                    {organizations.map((organization) => (<option value={organization.id} key={organization.id}>
                        {organization.name}
                      </option>))}
                  </select>)}
                <input name="name" placeholder={accountLabels.addClinic} disabled={!canMutate} required/>
                <input name="city" placeholder={text.city} disabled={!canMutate} required/>
                <input name="address" placeholder={accountLabels.address} disabled={!canMutate} required/>
                <input name="phone" placeholder={accountLabels.phone} disabled={!canMutate}/>
                <button type="submit" disabled={!canMutate}>
                  {accountLabels.addClinic}
                </button>
              </form>
              {formClinics.map((clinic) => (<article className="settings-clinic-row" key={clinic.id}>
                  <form action={updateClinicAction} className="settings-clinic-edit-form">
                    <input name="clinicId" type="hidden" value={clinic.id}/>
                    {!canManageSystems && <input name="organizationId" type="hidden" value={clinic.organizationId}/>}
                    <div className="settings-clinic-status">
                      <div>
                        <strong>{clinic.name}</strong>
                        {canManageSystems && <span>{clinic.organizationName}</span>}
                      </div>
                      <StatusPill status={clinic.active ? "ACTIVE" : "INACTIVE"}/>
                    </div>
                    {canManageSystems && (<small>{accountLabels.systemScope}: {clinic.organizationName}</small>)}
                    <label>
                      {text.clinic}
                      <input name="name" defaultValue={clinic.name} disabled={!canMutate} required/>
                    </label>
                    <label>
                      {text.city}
                      <input name="city" defaultValue={clinic.city} disabled={!canMutate} required/>
                    </label>
                    <details className="settings-clinic-advanced">
                      <summary>{accountLabels.advancedDetails}</summary>
                      <div>
                        <label>
                          {accountLabels.address}
                          <input name="address" defaultValue={clinic.address} disabled={!canMutate} required/>
                        </label>
                        <label>
                          {accountLabels.phone}
                          <input name="phone" defaultValue={clinic.phone ?? ""} disabled={!canMutate}/>
                        </label>
                      </div>
                    </details>
                    <div className="settings-clinic-actions">
                      <button type="submit" disabled={!canMutate}>
                        {accountLabels.saveClinic}
                      </button>
                      <button form={`toggle-clinic-${clinic.id}`} type="submit" disabled={!canMutate}>
                        {clinic.active
                ? accountLabels.deactivateClinic
                : accountLabels.activateClinic}
                      </button>
                    </div>
                  </form>
                  <details className="settings-chair-manager">
                    <summary>
                      <span>{chairLabels.treatmentChairs}</span>
                      <b>{clinic.chairs.filter((chair) => chair.active).length}/{clinic.chairs.length}</b>
                    </summary>
                    <form action={createChairAction} className="settings-chair-form">
                      <input name="clinicId" type="hidden" value={clinic.id}/>
                      <input name="name" placeholder={chairLabels.chairName} disabled={!canMutate || !clinic.active} required/>
                      <select name="specialty" defaultValue="Tổng quát" disabled={!canMutate || !clinic.active}>
                        <option value="Tổng quát">{chairLabels.general}</option>
                        <option value="Tiểu phẫu">{chairLabels.surgery}</option>
                        <option value="Chỉnh nha">{chairLabels.orthodontics}</option>
                        <option value="Implant">{chairLabels.implant}</option>
                      </select>
                      <button type="submit" disabled={!canMutate || !clinic.active}>
                        {chairLabels.addChair}
                      </button>
                    </form>
                    <div className="settings-chair-list">
                      {clinic.chairs.length > 0 ? (clinic.chairs.map((chair) => (<form action={updateChairAction} className="settings-chair-row" key={chair.id}>
                            <input name="chairId" type="hidden" value={chair.id}/>
                            <input name="clinicId" type="hidden" value={clinic.id}/>
                            <div className="settings-chair-title">
                              <strong>{chair.name}</strong>
                              <StatusPill status={chair.active ? "ACTIVE" : "INACTIVE"}/>
                            </div>
                            <input name="name" defaultValue={chair.name} disabled={!canMutate} required/>
                            <select name="specialty" defaultValue={chair.specialty ?? "Tổng quát"} disabled={!canMutate}>
                              <option value="Tổng quát">{chairLabels.general}</option>
                              <option value="Tiểu phẫu">{chairLabels.surgery}</option>
                              <option value="Chỉnh nha">{chairLabels.orthodontics}</option>
                              <option value="Implant">{chairLabels.implant}</option>
                            </select>
                            <button type="submit" disabled={!canMutate}>
                              {chairLabels.saveChair}
                            </button>
                            <button form={`toggle-chair-${chair.id}`} type="submit" disabled={!canMutate}>
                              {chair.active ? chairLabels.deactivateChair : chairLabels.activateChair}
                            </button>
                          </form>))) : (<EmptyState label={chairLabels.noChairs}/>)}
                    </div>
                  </details>
                </article>))}
            </div>
            {formClinics.map((clinic) => (<div key={`toggle-forms-${clinic.id}`}>
                <form action={toggleClinicStatusAction} id={`toggle-clinic-${clinic.id}`} onSubmit={(event) => {
                if (!window.confirm(confirmText.clinicStatus)) {
                    event.preventDefault();
                }
            }}>
                  <input name="clinicId" type="hidden" value={clinic.id}/>
                  <input name="active" type="hidden" value={clinic.active ? "false" : "true"}/>
                </form>
                {clinic.chairs.map((chair) => (<form action={toggleChairStatusAction} id={`toggle-chair-${chair.id}`} key={chair.id} onSubmit={(event) => {
                    if (!window.confirm(chairLabels.confirmChairStatus)) {
                        event.preventDefault();
                    }
                }}>
                    <input name="chairId" type="hidden" value={chair.id}/>
                    <input name="clinicId" type="hidden" value={clinic.id}/>
                    <input name="active" type="hidden" value={chair.active ? "false" : "true"}/>
                  </form>))}
              </div>))}
          </section>

          <section className="panel" data-settings-block="archive">
            <PanelHeader icon={Archive} title={accountLabels.archive} action={`${archiveResultCount} · ${accountLabels.archivedClinicData}`}/>
            <div className="settings-archive-note">
              {accountLabels.archivedClinicNote}
            </div>
            <label className="settings-archive-search">
              {accountLabels.archiveSearch}
              <input value={settingsArchiveSearch} onChange={(event) => setSettingsArchiveSearch(event.target.value)} placeholder={accountLabels.archiveSearchPlaceholder}/>
            </label>
            <div className="settings-archive-list">
              {filteredArchivedClinics.map((clinic) => (<article className="settings-archive-row" key={clinic.clinicId}>
                  <div className="settings-archive-head">
                    <div>
                      <strong>{clinic.name}</strong>
                      <span>{canManageSystems ? `${clinic.organizationName} · ${clinic.city}` : clinic.city}</span>
                    </div>
                    <StatusPill status="INACTIVE"/>
                  </div>
                  <div className="settings-archive-counts">
                    <span>{accountLabels.patients}: {clinic.patientCount}</span>
                    <span>{accountLabels.appointments}: {clinic.appointmentCount}</span>
                    <span>{accountLabels.invoices}: {clinic.invoiceCount}</span>
                    <span>{accountLabels.receipts}: {clinic.receiptCount}</span>
                    <span>{accountLabels.staffAccounts}: {clinic.staffCount}</span>
                  </div>
                  <small>
                    {accountLabels.latestActivity}: {clinic.latestActivityAt ?? "-"}
                  </small>
                  <form action={toggleClinicStatusAction} onSubmit={(event) => {
                if (!window.confirm(confirmText.clinicStatus)) {
                    event.preventDefault();
                }
            }}>
                    <input name="clinicId" type="hidden" value={clinic.clinicId}/>
                    <input name="active" type="hidden" value="true"/>
                    <button type="submit" disabled={!canMutate}>
                      {accountLabels.activateClinic}
                    </button>
                  </form>
                </article>))}
              {archiveResultCount === 0 && <EmptyState label={accountLabels.archiveEmpty}/>}
            </div>
          </section>

          <section className="panel" data-settings-block="organization">
            <PanelHeader icon={WalletCards} title={accountLabels.sourceCommission} action={formatVnd(sourceCommissionTotal)}/>
            <form action={createSourceCommissionPolicyAction} className="settings-clinic-form">
              <select name="source" disabled={!canMutate}>
                {leadSourceOptions.map((source) => (<option value={source.value} key={source.value}>
                    {source.label}
                  </option>))}
              </select>
              <input name="name" placeholder={accountLabels.sourcePolicy} disabled={!canMutate} required/>
              <input name="ownerLabel" placeholder={accountLabels.sourceOwner} disabled={!canMutate}/>
              <input name="ratePercent" inputMode="decimal" placeholder={accountLabels.sourceRate} disabled={!canMutate} required/>
              <input name="fixedAmount" inputMode="decimal" placeholder={accountLabels.fixedAmount} disabled={!canMutate}/>
              <input name="monthlyBudget" inputMode="decimal" placeholder={accountLabels.monthlyBudget} disabled={!canMutate}/>
              <button type="submit" disabled={!canMutate}>
                {accountLabels.addSourcePolicy}
              </button>
            </form>
            <form action={generateSourceCommissionAccrualsAction} className="service-action-row">
              <button type="submit" disabled={!canMutate || sourceCommission.policies.length === 0}>
                {accountLabels.generateAccruals}
              </button>
              <Link className="secondary-button" href="/settings/source-commission-export">
                {accountLabels.exportCsv}
              </Link>
            </form>
            <div className="settings-archive-list">
              {sourceCommission.policies.map((policy) => (<article className="settings-archive-row" key={policy.id}>
                  <div className="settings-archive-head">
                    <div>
                      <strong>{policy.source}</strong>
                      <span>{policy.name}</span>
                    </div>
                    <StatusPill status={policy.active ? "ACTIVE" : "INACTIVE"}/>
                  </div>
                  <div className="settings-archive-counts">
                    <span>{accountLabels.sourceRate}: {policy.ratePercent}%</span>
                    <span>{accountLabels.fixedAmount}: {formatVnd(policy.fixedAmount)}</span>
                    <span>{accountLabels.monthlyBudget}: {policy.monthlyBudget == null ? "-" : formatVnd(policy.monthlyBudget)}</span>
                  </div>
                  <form action={toggleSourceCommissionPolicyAction}>
                    <input name="policyId" type="hidden" value={policy.id}/>
                    <input name="active" type="hidden" value={policy.active ? "false" : "true"}/>
                    <button type="submit" disabled={!canMutate}>
                      {policy.active ? text.deactivate : text.activate}
                    </button>
                  </form>
                </article>))}
              {sourceCommission.policies.length === 0 && (<EmptyState label={accountLabels.sourcePolicy}/>)}
            </div>
            <div className="record-grid">
              {sourceCommission.accruals.slice(0, 6).map((accrual) => (<div className="record-card" key={accrual.id}>
                  <strong>{accrual.source} · {accrual.patientName}</strong>
                  <span>{formatVnd(accrual.commissionAmount)} · {accrual.receiptNo}</span>
                  <small>{displayStatus(accrual.status, language)} · {accrual.earnedAt}</small>
                  <div className="service-action-row">
                    {accrual.status === "EARNED" && (<form action={updateSourceCommissionAccrualStatusAction}>
                        <input name="accrualId" type="hidden" value={accrual.id}/>
                        <input name="status" type="hidden" value="APPROVED"/>
                        <button type="submit" disabled={!canMutate}>
                          {accountLabels.approve}
                        </button>
                      </form>)}
                    {accrual.status === "APPROVED" && (<form action={updateSourceCommissionAccrualStatusAction} onSubmit={(event) => {
                    if (!window.confirm(confirmText.sourceCommissionPaid)) {
                        event.preventDefault();
                    }
                }}>
                        <input name="accrualId" type="hidden" value={accrual.id}/>
                        <input name="status" type="hidden" value="PAID"/>
                        <button type="submit" disabled={!canMutate}>
                          {accountLabels.markPaid}
                        </button>
                      </form>)}
                  </div>
                </div>))}
            </div>
          </section>

          <section className="panel" data-settings-block="providers">
            <PanelHeader icon={Bell} title={accountLabels.notificationSettings} action={notificationSettings?.deliveryMode ?? "-"}/>
            <div className="record-grid">
              <RecordTile title={accountLabels.notificationMode} value={notificationSettings?.deliveryMode ?? "-"}/>
              <RecordTile title={accountLabels.resendFrom} value={notificationSettings?.resendFromEmail ?? "-"}/>
              <RecordTile title={accountLabels.recentSent} value={String(notificationSettings?.recentSent ?? 0)}/>
              <RecordTile title={accountLabels.recentFailed} value={String(notificationSettings?.recentFailed ?? 0)}/>
            </div>
            <div className="settings-provider-readiness" aria-label={accountLabels.notificationProviderStatus}>
              <div className="settings-provider-readiness-head">
                <strong>{accountLabels.notificationProviderStatus}</strong>
                <span>{accountLabels.notificationProviderHint}</span>
              </div>
              <div className="settings-provider-readiness-grid">
                {notificationReadiness.map((item) => (<article className="settings-provider-tile" key={item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                    <small>{item.status}</small>
                  </article>))}
              </div>
            </div>
            <form action={sendNotificationTestAction} className="settings-clinic-form">
              <select name="channel" disabled={!canMutate} defaultValue="EMAIL">
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
                <option value="ZALO">Zalo</option>
              </select>
              <input name="recipient" placeholder={accountLabels.notificationRecipient} disabled={!canMutate} required/>
              <input name="subject" placeholder={accountLabels.notificationSubject} disabled={!canMutate}/>
              <input name="body" placeholder={accountLabels.notificationBody} disabled={!canMutate}/>
              <button type="submit" disabled={!canMutate}>
                {accountLabels.notificationTest}
              </button>
            </form>
          </section>

          <section className="panel" data-settings-block="providers">
            <PanelHeader icon={MessageSquareText} title={accountLabels.aiAudit} action={`${filteredAiRuns.length}/${aiRuns.length} · ${accountLabels.aiAuditSubtitle}`}/>
            <div className="settings-provider-readiness settings-ai-provider-readiness" aria-label={accountLabels.aiProviderStatus}>
              <div className="settings-provider-readiness-head">
                <strong>{accountLabels.aiProviderStatus}</strong>
                <span>{accountLabels.aiProviderHint}</span>
              </div>
              <div className="settings-provider-readiness-grid">
                {aiProviderReadiness.map((item) => (<article className="settings-provider-tile" key={item.label}>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.value}</span>
                    </div>
                    <small>{item.status}</small>
                  </article>))}
              </div>
              {aiSettings?.error ? <small>{aiSettings.error}</small> : null}
            </div>
            <div className="settings-clinic-form">
              <input value={aiAuditQuery} onChange={(event) => setAiAuditQuery(event.target.value)} placeholder={accountLabels.aiAuditSearch}/>
              <select value={aiAuditModule} onChange={(event) => setAiAuditModule(event.target.value)}>
                <option value="all">{accountLabels.allModules}</option>
                {aiAuditModules.map((moduleName) => (<option value={moduleName} key={moduleName}>
                    {moduleName}
                  </option>))}
              </select>
              <select value={aiAuditStatus} onChange={(event) => setAiAuditStatus(event.target.value)}>
                <option value="all">{accountLabels.allStatuses}</option>
                <option value="SUCCEEDED">SUCCEEDED</option>
                <option value="FAILED">FAILED</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>
            <div className="settings-archive-list">
              {filteredAiRuns.length > 0 ? (filteredAiRuns.map((run) => (<article className="settings-archive-row" key={run.id}>
                    <div className="settings-archive-head">
                      <div>
                        <strong>{run.module} · {run.action}</strong>
                        <span>{run.provider} / {run.model}</span>
                      </div>
                      <StatusPill status={run.status}/>
                    </div>
                    <div className="settings-archive-counts">
                      <span>{run.createdAt}</span>
                      <span>{run.actor ?? "System"}</span>
                      <span>{accountLabels.aiTokens}: {run.totalTokens ?? "-"}</span>
                    </div>
                    {run.error ? <small>{run.error}</small> : null}
                  </article>))) : (<EmptyState label={accountLabels.aiAuditSubtitle}/>)}
            </div>
          </section>

          <section className="panel" data-settings-block="governance">
            <PanelHeader icon={ShieldCheck} title={accountLabels.securityPosture} action={text.review}/>
            <div className="compliance-list settings-compliance-list">
              {text.complianceItems.map((item, index) => (<label key={item}>
                  <input type="checkbox" defaultChecked={index < 3} readOnly/>
                  {item}
                </label>))}
            </div>
          </section>
        </aside>);
}

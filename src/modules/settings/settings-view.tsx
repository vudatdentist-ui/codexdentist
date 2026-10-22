"use client";
import { StaffDirectorySection } from "./StaffDirectorySection";
import { OrganizationSettingsSection } from "./OrganizationSettingsSection";
import { StaffAccountDialog } from "./StaffAccountDialog";
import { OperationalDialog, WorkspaceTabs } from "@/components/ui/WorkspaceControls";
import { Activity, CheckCircle2, ShieldCheck, UsersRound, X } from "lucide-react";
import { createStaffAction, } from "@/app/(app)/settings/actions";
import { MetricCard, PanelHeader, RecordTile } from "@/components/suite-primitives";
import { workspaceMessageText } from "./settings-shared";
import type { SettingsPanelModel } from "./settings-model";
export function SettingsPanelView(model: SettingsPanelModel) {
    const { settingsWorkspace, language, text, notice, settingsModal, setSettingsModal, settingsSection, selectSettingsSection, setupEmail, formClinics, activeFormClinics, organizations, staff, auditItems, staffAccountRoleOptions, organizationWideRoleValues, staffCreateReady, activeStaff, pendingPasswordStaff, ownerStaff, settingsSections, permissionMatrix, accountLabels, selectedStaff, } = model;
    return (<section className="view-stack">
      <div className="workspace-actions">

        <div className="service-action-row">
          <button className="primary-button" type="button" disabled={!staffCreateReady} onClick={() => setSettingsModal("staff")}>
            <UsersRound size={16}/>
            {text.createStaff}
          </button>

        </div>
      </div>

      {(settingsWorkspace?.message || notice) && (<div className={notice ? "schedule-alert action" : "schedule-alert"}>
          {notice ?? workspaceMessageText(settingsWorkspace?.message, language)}
        </div>)}
      {setupEmail && (<div className="credential-box">
          <strong>{accountLabels.setupLinkReady}</strong>
          <span>{accountLabels.setupEmailQueued}</span>
          <small>
            {accountLabels.setupRecipient}: {setupEmail}
          </small>
          <small>{accountLabels.setupLinkNote}</small>
        </div>)}

      <section className="metric-grid settings-metric-grid">
        <MetricCard label={accountLabels.totalStaff} value={String(staff.length)} tone="blue"/>
        <MetricCard label={text.active} value={String(activeStaff.length)} tone="green"/>
        <MetricCard label={accountLabels.pendingSetup} value={String(pendingPasswordStaff.length)} tone="teal"/>
        <MetricCard label={accountLabels.activeOwners} value={String(ownerStaff.length)} tone="violet"/>
        <MetricCard label={accountLabels.systemScope} value={String(organizations.length)} tone="violet"/>
        <MetricCard label={accountLabels.visibleClinics} value={String(formClinics.length)} tone="blue"/>
      </section>

      <WorkspaceTabs className="segmented settings-section-tabs" role="tablist" aria-label={text.admin}>
        {settingsSections.map((section) => (<button aria-selected={settingsSection === section.key} className={settingsSection === section.key ? "active" : ""} key={section.key} onClick={() => selectSettingsSection(section.key)} role="tab" type="button">
            {section.label}
          </button>))}
      </WorkspaceTabs>

      <section className="settings-overview-grid" data-settings-section={settingsSection}>
        <StaffDirectorySection {...model}/>

        <OrganizationSettingsSection {...model}/>
      </section>

      {settingsSection === "governance" && (<>
          <section className="settings-lower-grid">
            <section className="panel">
              <PanelHeader icon={ShieldCheck} title={accountLabels.accessMatrix} action={text.staffRoles}/>
              <div className="permission-list settings-permissions">
                {permissionMatrix.map((item) => (<div className="permission-row settings-permission-card" key={item.role}>
                    <div>
                      <strong>{item.role}</strong>
                      <span>{item.scope}</span>
                    </div>
                    <small>{item.access}</small>
                    <div className="settings-permission-modules" aria-label={accountLabels.moduleAccess}>
                      {item.modules.map((moduleName) => (<span key={`${item.role}-${moduleName}`}>{moduleName}</span>))}
                    </div>
                  </div>))}
              </div>
            </section>

            <section className="panel">
              <PanelHeader icon={Activity} title={text.auditTrail} action={accountLabels.auditSubtitle}/>
              <div className="settings-audit-list">
                {auditItems.map((item, index) => (<span key={`${item}-${index}`}>{item}</span>))}
              </div>
            </section>
          </section>

          <section className="panel">
            <PanelHeader icon={CheckCircle2} title={text.readiness} action={text.readinessAction}/>
            <div className="record-grid">
              {text.readinessItems.map(([status, item]) => (<RecordTile title={status} value={item} key={`${status}-${item}`}/>))}
            </div>
          </section>
        </>)}

      {settingsModal === "staff-config" && selectedStaff && (<StaffAccountDialog {...model}/>)}

      {settingsModal === "staff" && (<OperationalDialog label={accountLabels.createStaffTitle} onClose={() => setSettingsModal(null)}>
          <form action={createStaffAction} className="progress-modal settings-staff-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setSettingsModal(null)}>
            <div className="progress-modal-header">
              <div>
                <span>{text.admin}</span>
                <h3>{accountLabels.createStaffTitle}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsModal(null)}>
                <X size={16}/>
              </button>
            </div>
            <div className="progress-modal-grid modal-form-grid">
              <label>
                {text.fullName}
                <input name="fullName" disabled={!staffCreateReady} required/>
              </label>
              <label>
                {text.email}
                <input name="email" type="email" disabled={!staffCreateReady} required/>
              </label>
              <label>
                {accountLabels.title}
                <input name="title" disabled={!staffCreateReady}/>
              </label>
              <label>
                {text.clinic}
                <select name="clinicId" disabled={!staffCreateReady} required>
                  {activeFormClinics.map((clinic) => (<option value={clinic.id} key={clinic.id}>
                      {clinic.name}
                    </option>))}
                </select>
              </label>
              <fieldset className="settings-role-assignment-fieldset">
                <legend>{accountLabels.accessRoles}</legend>
                <div className="settings-role-checkbox-grid">
                  {staffAccountRoleOptions.map(([value, label]) => (<label key={`create-${value}`}>
                      <input name="assignmentRole" type="checkbox" value={value} defaultChecked={value === "FRONT_DESK"} disabled={!staffCreateReady}/>
                      <span>
                        {label}
                        <small>
                          {organizationWideRoleValues.has(value)
                    ? accountLabels.globalScope
                    : accountLabels.accessScope}
                        </small>
                      </span>
                    </label>))}
                </div>
              </fieldset>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setSettingsModal(null)}>
                {accountLabels.cancel}
              </button>
              <button className="primary-button" type="submit" disabled={!staffCreateReady}>
                <UsersRound size={16}/>
                {text.createStaff}
              </button>
            </div>
          </form>
        </OperationalDialog>)}
    </section>);
}

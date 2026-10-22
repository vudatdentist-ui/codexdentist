"use client";
import { OperationalDialog, WorkspaceTabs } from "@/components/ui/WorkspaceControls";
import { LockKeyhole, X } from "lucide-react";
import { createStaffPasswordSetupLinkAction, toggleStaffStatusAction, updateStaffProfileAction, updateStaffRoleAction } from "@/app/(app)/settings/actions";
import type { SettingsPanelModel } from "./settings-model";
export function StaffAccountDialog(model: Pick<SettingsPanelModel, "accountLabels" | "setSettingsModal" | "setSelectedStaffId" | "selectedStaff" | "text" | "selectedStaffIsPatient" | "staffConfigTab" | "setStaffConfigTab" | "formReady" | "selectedStaffClinicOptions" | "selectedStaffAssignmentClinicId" | "activeFormClinics" | "staffAccountRoleOptions" | "selectedStaffAssignmentRoles" | "organizationWideRoleValues" | "confirmText">) {
    const { accountLabels, setSettingsModal, setSelectedStaffId, selectedStaff, text, selectedStaffIsPatient, staffConfigTab, setStaffConfigTab, formReady, selectedStaffClinicOptions, selectedStaffAssignmentClinicId, activeFormClinics, staffAccountRoleOptions, selectedStaffAssignmentRoles, organizationWideRoleValues, confirmText } = model;
    if (!selectedStaff)
        return null;
    return (<OperationalDialog label={accountLabels.accountControls} onClose={() => {
            setSettingsModal(null);
            setSelectedStaffId(null);
        }}>
          <div className="progress-modal settings-staff-modal settings-staff-config-modal" onClick={(event) => event.stopPropagation()}>
            <div className="progress-modal-header">
              <div>
                <span>{accountLabels.accountControls}</span>
                <h3>{selectedStaff.fullName}</h3>
              </div>
              <button className="icon-button" type="button" onClick={() => {
            setSettingsModal(null);
            setSelectedStaffId(null);
        }}>
                <X size={16}/>
              </button>
            </div>

            <div className="settings-staff-config-summary">
              <span>{selectedStaff.email}</span>
              <span>{accountLabels.title}: {selectedStaff.title ?? accountLabels.notProvided}</span>
              <span>
                {selectedStaff.clinics.map((clinic) => clinic.name).join(", ") || text.noClinic}
              </span>
            </div>

            <WorkspaceTabs className="segmented settings-staff-config-tabs" role="tablist" aria-label={accountLabels.accountControls}>
              {!selectedStaffIsPatient && (<>
                  <button aria-selected={staffConfigTab === "profile"} className={staffConfigTab === "profile" ? "active" : ""} onClick={() => setStaffConfigTab("profile")} role="tab" type="button">
                    {accountLabels.profileTab}
                  </button>
                  <button aria-selected={staffConfigTab === "access"} className={staffConfigTab === "access" ? "active" : ""} onClick={() => setStaffConfigTab("access")} role="tab" type="button">
                    {accountLabels.accessTab}
                  </button>
                </>)}
              <button aria-selected={staffConfigTab === "security"} className={staffConfigTab === "security" ? "active" : ""} onClick={() => setStaffConfigTab("security")} role="tab" type="button">
                {accountLabels.securityTab}
              </button>
            </WorkspaceTabs>

            {staffConfigTab === "profile" && !selectedStaffIsPatient && (<form action={updateStaffProfileAction} className="settings-staff-config-form">
                <input name="userId" type="hidden" value={selectedStaff.id}/>
                <label>
                  {text.fullName}
                  <input name="fullName" defaultValue={selectedStaff.fullName} disabled={!formReady} required/>
                </label>
                <label>
                  {accountLabels.phone}
                  <input name="phone" defaultValue={selectedStaff.phone ?? ""} disabled={!formReady}/>
                </label>
                <label>
                  {accountLabels.employeeCode}
                  <input name="employeeCode" defaultValue={selectedStaff.employeeCode ?? ""} disabled={!formReady}/>
                </label>
                <label>
                  {accountLabels.title}
                  <input name="title" defaultValue={selectedStaff.title ?? ""} disabled={!formReady}/>
                </label>
                <label>
                  {accountLabels.department}
                  <input name="department" defaultValue={selectedStaff.department ?? ""} disabled={!formReady}/>
                </label>
                <label>
                  {accountLabels.contractType}
                  <select name="contractType" defaultValue={selectedStaff.contractType ?? "FULL_TIME"} disabled={!formReady}>
                    <option value="FULL_TIME">Full-time</option>
                    <option value="PART_TIME">Part-time</option>
                    <option value="CONTRACTOR">Contractor</option>
                    <option value="INTERN">Intern</option>
                  </select>
                </label>
                <label>
                  {accountLabels.primaryClinic}
                  <select name="clinicId" defaultValue={selectedStaff.primaryClinicId ?? selectedStaffClinicOptions[0]?.id ?? ""} disabled={!formReady}>
                    <option value="">{text.noClinic}</option>
                    {selectedStaffClinicOptions.map((clinic) => (<option value={clinic.id} key={clinic.id}>
                        {clinic.name}
                      </option>))}
                  </select>
                </label>
                <label>
                  {accountLabels.gender}
                  <select name="gender" defaultValue={selectedStaff.gender ?? ""} disabled={!formReady}>
                    <option value="">{accountLabels.notProvided}</option>
                    <option value="Nam">{accountLabels.male}</option>
                    <option value="Nữ">{accountLabels.female}</option>
                    <option value="Khác">{accountLabels.otherGender}</option>
                  </select>
                </label>
                <label>
                  {accountLabels.dateOfBirth}
                  <input name="dateOfBirth" type="date" defaultValue={selectedStaff.dateOfBirthIso ?? ""} disabled={!formReady}/>
                </label>
                <label>
                  {accountLabels.hireDate}
                  <input name="hireDate" type="date" defaultValue={selectedStaff.hireDateIso ?? ""} disabled={!formReady}/>
                </label>
                <label>
                  {accountLabels.salary}
                  <input name="baseSalary" inputMode="decimal" defaultValue={selectedStaff.baseSalary ?? ""} disabled={!formReady}/>
                </label>
                <label className="settings-profile-file-field">
                  {accountLabels.profilePhoto}
                  <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!formReady}/>
                </label>
                <div className="progress-modal-actions">
                  <button className="primary-button" type="submit" disabled={!formReady}>
                    {accountLabels.saveProfile}
                  </button>
                </div>
              </form>)}

            {staffConfigTab === "access" && !selectedStaffIsPatient && (<form action={updateStaffRoleAction} className="settings-staff-config-form settings-access-config-form">
                <input name="userId" type="hidden" value={selectedStaff.id}/>
                <label>
                  {accountLabels.accessScope}
                  <select name="assignmentClinicId" defaultValue={selectedStaffAssignmentClinicId} disabled={!formReady}>
                    {activeFormClinics.map((clinic) => (<option value={clinic.id} key={clinic.id}>
                        {clinic.name}
                      </option>))}
                  </select>
                </label>
                <fieldset className="settings-role-assignment-fieldset">
                  <legend>{accountLabels.accessRoles}</legend>
                  <div className="settings-role-checkbox-grid">
                    {staffAccountRoleOptions.map(([value, label]) => (<label key={`config-${selectedStaff.id}-${value}`}>
                        <input name="assignmentRole" type="checkbox" value={value} defaultChecked={selectedStaffAssignmentRoles.has(value) ||
                    (selectedStaffAssignmentRoles.size === 0 && selectedStaff.role === value)} disabled={!formReady}/>
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
                  <small>{accountLabels.roleScopeHint}</small>
                </fieldset>
                <div className="progress-modal-actions">
                  <button className="primary-button" type="submit" disabled={!formReady}>
                    {text.save}
                  </button>
                </div>
              </form>)}

            {staffConfigTab === "security" && (<div className="settings-security-config">
                <div className="settings-password-state">
                  <LockKeyhole size={14}/>
                  <span>
                    {selectedStaff.mustChangePassword || selectedStaff.hasPendingPasswordSetup
                ? accountLabels.passwordPending
                : selectedStaff.passwordChangedAt
                    ? `${accountLabels.passwordChanged}: ${selectedStaff.passwordChangedAt}`
                    : accountLabels.passwordChanged}
                  </span>
                </div>
                <div className="settings-staff-actions">
                  <form action={toggleStaffStatusAction} onSubmit={(event) => {
                if (!window.confirm(confirmText.staffStatus)) {
                    event.preventDefault();
                }
            }}>
                    <input name="userId" type="hidden" value={selectedStaff.id}/>
                    <input name="active" type="hidden" value={selectedStaff.active ? "false" : "true"}/>
                    <button type="submit" disabled={!formReady}>
                      {selectedStaff.active ? text.deactivate : text.activate}
                    </button>
                  </form>
                  <form action={createStaffPasswordSetupLinkAction} onSubmit={(event) => {
                if (!window.confirm(confirmText.passwordSetup)) {
                    event.preventDefault();
                }
            }}>
                    <input name="userId" type="hidden" value={selectedStaff.id}/>
                    <button type="submit" disabled={!formReady || !selectedStaff.canCreatePasswordSetup} title={selectedStaff.canCreatePasswordSetup
                ? accountLabels.createPasswordLink
                : accountLabels.selfPasswordLinkBlocked}>
                      {selectedStaff.canCreatePasswordSetup
                ? accountLabels.createPasswordLink
                : accountLabels.selfPasswordLinkBlocked}
                    </button>
                  </form>
                </div>
              </div>)}
          </div>
        </OperationalDialog>);
}

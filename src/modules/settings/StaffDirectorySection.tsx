"use client";
import { LockKeyhole, UsersRound, } from "lucide-react";
import { createStaffPasswordSetupLinkAction, toggleStaffStatusAction, updateStaffProfileAction, updateStaffRoleAction } from "@/app/(app)/settings/actions";
import { EmptyState, PanelHeader } from "@/components/suite-primitives";
import { type AppRole } from "@/lib/permissions";
import { roleText, StatusPill } from "./settings-shared";
import type { SettingsPanelModel } from "./settings-model";
export function StaffDirectorySection(model: Pick<SettingsPanelModel, "accountLabels" | "staffSearch" | "setStaffSearch" | "text" | "staffRoleFilter" | "setStaffRoleFilter" | "roleOptions" | "roleCounts" | "filteredStaff" | "staffGroups" | "activeFormClinics" | "language" | "setSelectedStaffId" | "setStaffConfigTab" | "setSettingsModal" | "formReady" | "staffAccountRoleOptions" | "organizationWideRoleValues" | "confirmText">) {
    const { accountLabels, staffSearch, setStaffSearch, text, staffRoleFilter, setStaffRoleFilter, roleOptions, roleCounts, filteredStaff, staffGroups, activeFormClinics, language, setSelectedStaffId, setStaffConfigTab, setSettingsModal, formReady, staffAccountRoleOptions, organizationWideRoleValues, confirmText } = model;
    return (<section className="panel settings-staff-panel" data-settings-block="accounts">
          <PanelHeader icon={UsersRound} title={accountLabels.staffDirectory} action={accountLabels.manageStaff}/>
          <div className="settings-clinic-form">
            <label>
              {accountLabels.staffSearch}
              <input value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} placeholder={accountLabels.staffSearchPlaceholder}/>
            </label>
            <label>
              {text.role}
              <select value={staffRoleFilter} onChange={(event) => setStaffRoleFilter(event.target.value as AppRole | "all")}>
                <option value="all">{accountLabels.staffFilterAllRoles}</option>
                {roleOptions.map(([value, label]) => (<option value={value} key={value}>
                    {label}
                  </option>))}
              </select>
            </label>
          </div>
          <div className="settings-role-chips">
            {roleCounts.map((item) => (<span key={item.value}>{item.label}: {item.count}</span>))}
          </div>
          <div className="settings-account-groups">
            {filteredStaff.length > 0 ? (staffGroups.map((group) => (<section className="settings-account-group" key={group.key}>
                  <div className="settings-account-group-head">
                    <div>
                      <strong>{group.title}</strong>
                      <span>{group.description}</span>
                    </div>
                    <b>{group.members.length}</b>
                  </div>
                  <div className="settings-staff-grid">
                    {group.members.length > 0 ? (group.members.map((member) => {
                const memberClinicOptions = member.clinics.filter((clinic) => clinic.active).length > 0
                    ? member.clinics.filter((clinic) => clinic.active)
                    : activeFormClinics;
                const isPatientAccount = member.role === "PATIENT";
                const activeRoleAssignments = member.roleAssignments.filter((assignment) => assignment.active);
                const roleAssignmentRoles = new Set(activeRoleAssignments.map((assignment) => assignment.role));
                const assignmentClinicId = activeRoleAssignments.find((assignment) => assignment.clinicId)?.clinicId ??
                    member.primaryClinicId ??
                    member.clinics[0]?.id ??
                    activeFormClinics[0]?.id ??
                    "";
                const completedProfileFields = [
                    member.employeeCode,
                    member.title,
                    member.department,
                    member.contractType,
                    member.primaryClinicId,
                    member.hireDateIso,
                    member.baseSalary,
                ].filter(Boolean).length;
                const profileFieldTotal = 7;
                const profileCompletionPercent = Math.round((completedProfileFields / profileFieldTotal) * 100);
                return (<article className="settings-staff-card compact" key={member.id}>
                  <div className="settings-staff-card-head">
                    <div className="settings-staff-identity">
                      <div className="settings-staff-avatar">
                        {member.avatarUrl ? (<img src={member.avatarUrl} alt={member.fullName}/>) : (<span>{member.fullName.slice(0, 1).toUpperCase()}</span>)}
                      </div>
                      <div>
                        <strong>{member.fullName}</strong>
                        <span>{member.email}</span>
                      </div>
                    </div>
                    <StatusPill status={member.active ? "Active" : "Inactive"}/>
                  </div>
                  <div className="settings-staff-quickline">
                    <span>{accountLabels.title}: {member.title ?? accountLabels.notProvided}</span>
                    <span>{member.clinics.map((clinic) => clinic.name).join(", ") || text.noClinic}</span>
                  </div>
                  {!isPatientAccount && (<div className="settings-role-chips">
                      {(activeRoleAssignments.length > 0
                            ? activeRoleAssignments
                            : [{ role: member.role, clinicName: null, scope: "GLOBAL" as const }]).map((assignment) => (<span key={`${member.id}-${assignment.role}-${assignment.clinicName ?? "global"}`}>
                          {roleText[language][assignment.role]} ·{" "}
                          {assignment.scope === "GLOBAL"
                                ? accountLabels.globalScope
                                : assignment.clinicName ?? text.clinic}
                        </span>))}
                    </div>)}
                  <div className="settings-staff-profile-summary">
                    {isPatientAccount ? (<span>{accountLabels.patientAccountNote}</span>) : (<>
                        <span>{accountLabels.employeeCode}: {member.employeeCode ?? accountLabels.notProvided}</span>
                      </>)}
                    <span>{accountLabels.lastLogin}: {member.lastLoginAt ?? "-"}</span>
                  </div>
                  {!isPatientAccount && (<div className="settings-profile-completeness">
                      <div>
                        <strong>{accountLabels.profileCompleteness}</strong>
                        <span>
                          {completedProfileFields}/{profileFieldTotal} {accountLabels.profileFieldsReady}
                        </span>
                      </div>
                      <div className="settings-profile-completeness-track" aria-hidden="true">
                        <span style={{ width: `${profileCompletionPercent}%` }}/>
                      </div>
                    </div>)}
                  <div className="settings-password-state">
                    <LockKeyhole size={14}/>
                    <span>
                      {member.mustChangePassword || member.hasPendingPasswordSetup
                        ? accountLabels.passwordPending
                        : member.passwordChangedAt
                            ? `${accountLabels.passwordChanged}: ${member.passwordChangedAt}`
                            : accountLabels.passwordChanged}
                    </span>
                  </div>
                  <div className="settings-staff-card-actions">
                    <button className="secondary-button" type="button" onClick={() => {
                        setSelectedStaffId(member.id);
                        setStaffConfigTab(isPatientAccount ? "security" : "profile");
                        setSettingsModal("staff-config");
                    }}>
                      {accountLabels.configureStaff}
                    </button>
                  </div>
                  <details className="settings-staff-account-editor">
                    <summary>{accountLabels.accountControls}</summary>
                    <div className="settings-staff-actions">
                      {!isPatientAccount && (<form action={updateStaffRoleAction} className="settings-role-assignment-form">
                          <input name="userId" type="hidden" value={member.id}/>
                          <label>
                            {accountLabels.accessScope}
                            <select name="assignmentClinicId" defaultValue={assignmentClinicId} disabled={!formReady}>
                              {activeFormClinics.map((clinic) => (<option value={clinic.id} key={clinic.id}>
                                  {clinic.name}
                                </option>))}
                            </select>
                          </label>
                          <fieldset>
                            <legend>{accountLabels.accessRoles}</legend>
                            <div className="settings-role-checkbox-grid">
                              {staffAccountRoleOptions.map(([value, label]) => (<label key={`${member.id}-${value}`}>
                                  <input name="assignmentRole" type="checkbox" value={value} defaultChecked={roleAssignmentRoles.has(value) ||
                                (roleAssignmentRoles.size === 0 && member.role === value)} disabled={!formReady}/>
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
                          <button type="submit" disabled={!formReady}>
                            {text.save}
                          </button>
                        </form>)}
                      <form action={toggleStaffStatusAction} onSubmit={(event) => {
                        if (!window.confirm(confirmText.staffStatus)) {
                            event.preventDefault();
                        }
                    }}>
                        <input name="userId" type="hidden" value={member.id}/>
                        <input name="active" type="hidden" value={member.active ? "false" : "true"}/>
                        <button type="submit" disabled={!formReady}>
                          {member.active ? text.deactivate : text.activate}
                        </button>
                      </form>
                      <form action={createStaffPasswordSetupLinkAction} onSubmit={(event) => {
                        if (!window.confirm(confirmText.passwordSetup)) {
                            event.preventDefault();
                        }
                    }}>
                        <input name="userId" type="hidden" value={member.id}/>
                        <button type="submit" disabled={!formReady || !member.canCreatePasswordSetup} title={member.canCreatePasswordSetup
                        ? accountLabels.createPasswordLink
                        : accountLabels.selfPasswordLinkBlocked}>
                          {member.canCreatePasswordSetup
                        ? accountLabels.createPasswordLink
                        : accountLabels.selfPasswordLinkBlocked}
                        </button>
                      </form>
                    </div>
                  </details>
                  {!isPatientAccount && (<details className="settings-staff-profile-editor">
                    <summary>{accountLabels.editProfile}</summary>
                    <form action={updateStaffProfileAction}>
                      <input name="userId" type="hidden" value={member.id}/>
                      <label>
                        {text.fullName}
                        <input name="fullName" defaultValue={member.fullName} disabled={!formReady} required/>
                      </label>
                      <label>
                        {accountLabels.phone}
                        <input name="phone" defaultValue={member.phone ?? ""} disabled={!formReady}/>
                      </label>
                      <label>
                        {accountLabels.employeeCode}
                        <input name="employeeCode" defaultValue={member.employeeCode ?? ""} disabled={!formReady}/>
                      </label>
                      <label>
                        {accountLabels.title}
                        <input name="title" defaultValue={member.title ?? ""} disabled={!formReady}/>
                      </label>
                      <label>
                        {accountLabels.department}
                        <input name="department" defaultValue={member.department ?? ""} disabled={!formReady}/>
                      </label>
                      <label>
                        {accountLabels.contractType}
                        <select name="contractType" defaultValue={member.contractType ?? "FULL_TIME"} disabled={!formReady}>
                          <option value="FULL_TIME">Full-time</option>
                          <option value="PART_TIME">Part-time</option>
                          <option value="CONTRACTOR">Contractor</option>
                          <option value="INTERN">Intern</option>
                        </select>
                      </label>
                      <label>
                        {accountLabels.primaryClinic}
                        <select name="clinicId" defaultValue={member.primaryClinicId ?? memberClinicOptions[0]?.id ?? ""} disabled={!formReady}>
                          <option value="">{text.noClinic}</option>
                          {memberClinicOptions.map((clinic) => (<option value={clinic.id} key={clinic.id}>
                              {clinic.name}
                            </option>))}
                        </select>
                      </label>
                      <label>
                        {accountLabels.gender}
                        <select name="gender" defaultValue={member.gender ?? ""} disabled={!formReady}>
                          <option value="">{accountLabels.notProvided}</option>
                          <option value="Nam">{accountLabels.male}</option>
                          <option value="Nữ">{accountLabels.female}</option>
                          <option value="Khác">{accountLabels.otherGender}</option>
                        </select>
                      </label>
                      <label>
                        {accountLabels.dateOfBirth}
                        <input name="dateOfBirth" type="date" defaultValue={member.dateOfBirthIso ?? ""} disabled={!formReady}/>
                      </label>
                      <label>
                        {accountLabels.hireDate}
                        <input name="hireDate" type="date" defaultValue={member.hireDateIso ?? ""} disabled={!formReady}/>
                      </label>
                      <label>
                        {accountLabels.salary}
                        <input name="baseSalary" inputMode="decimal" defaultValue={member.baseSalary ?? ""} disabled={!formReady}/>
                      </label>
                      <label className="settings-profile-file-field">
                        {accountLabels.profilePhoto}
                        <input name="avatar" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={!formReady}/>
                      </label>
                      <button type="submit" disabled={!formReady}>
                        {accountLabels.saveProfile}
                      </button>
                    </form>
                  </details>)}
                </article>);
            })) : (<EmptyState label={group.title}/>)}
                  </div>
                </section>))) : (<EmptyState label={text.noStaff}/>)}
          </div>
        </section>);
}

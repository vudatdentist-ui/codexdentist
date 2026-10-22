"use client";
import { MessageSquareText, PanelRightOpen } from "lucide-react";
import { chatModuleWithAiAction } from "@/app/(app)/ai/actions";
import { LanguageContext } from "@/components/AppLanguage";
import { AppSidebar, AppTopbar, ModuleAiFloatingShell } from "@/components/AppShell";
import { viewRoutes } from "@/lib/permissions";
import { EmptyState } from "@/components/suite-primitives";
import { Dashboard, ScheduleBoard, PatientsPanel, PatientJourneyPanel, BillingPanel, AccountingPanel, CrmPanel, ReportsPanel, CommunityPanel, PatientAppPanel, EmployeeAppPanel, ServicesPanel, PharmacyPanel, FormsPanel, InventoryPanel, LearningPanel, StaffPayrollPanel, SettingsPanel, workspaceText, titleFor, patientSearchDisplayLabel, PatientSearchCombobox, JourneyPatientMenu, journeyTopbarText, billingTopbarText, StatusPill } from "./suite-shared";
import type { DentalSuiteModel } from "./suite-model";
export function DentalSuiteView(model: Pick<DentalSuiteModel, "language" | "t" | "activeView" | "permittedViews" | "chainOptions" | "chainScopeId" | "taskInboxWorkspace" | "setChainScopeId" | "setPatientFilterId" | "setLanguage" | "session" | "hasTopbarControls" | "usesJourneyControls" | "setJourneyPatientMenuOpen" | "journeyChartSearch" | "setJourneyChartSearch" | "setJourneySearchShowsSelectedPatientLabel" | "journeyPatientSearchMatches" | "journeySelectedPatient" | "journeySearchShowsSelectedPatientLabel" | "selectJourneyPatient" | "visibleAppointments" | "billingWorkspace" | "visibleClinics" | "openPatientRoute" | "journeyPatientMenuOpen" | "visiblePatients" | "billingSearch" | "setBillingSearch" | "billingPatientSearchMatches" | "billingSelectedPatient" | "patientFilterId" | "patientLookupSearch" | "setPatientLookupSearch" | "patientLookupSearchMatches" | "selectedSharedPatient" | "moduleAiSupported" | "moduleAiText" | "moduleAiModalOpen" | "setModuleAiModalOpen" | "moduleAiContextJson" | "moduleAiMeta" | "showModuleAiResult" | "latestModuleAiRun" | "latestModuleAiOutput" | "moduleAiRuns" | "collection" | "production" | "todayVisits" | "utilization" | "patientScopedAppointments" | "dashboardWorkspace" | "scheduleWorkspace" | "scheduleScopedAppointments" | "patientWorkspace" | "clinicalWorkspace" | "crmWorkspace" | "formsWorkspace" | "journeyRecordsWorkspace" | "patientFilesWorkspace" | "pharmacyWorkspace" | "servicesWorkspace" | "staffDirectory" | "treatmentWorkspace" | "journeyReceipts" | "visibleInvoices" | "visiblePlans" | "journeyInvoiceIds" | "visibleClinicIds" | "patientScopedInvoices" | "patientScopedPatients" | "accountingWorkspace" | "reportsWorkspace" | "communityWorkspace" | "patientPortalWorkspace" | "staffPayrollWorkspace" | "inventoryWorkspace" | "learningWorkspace" | "settingsWorkspace">) {
    const { language, t, activeView, permittedViews, chainOptions, chainScopeId, taskInboxWorkspace, setChainScopeId, setPatientFilterId, setLanguage, session, hasTopbarControls, usesJourneyControls, setJourneyPatientMenuOpen, journeyChartSearch, setJourneyChartSearch, setJourneySearchShowsSelectedPatientLabel, journeyPatientSearchMatches, journeySelectedPatient, journeySearchShowsSelectedPatientLabel, selectJourneyPatient, visibleAppointments, billingWorkspace, visibleClinics, openPatientRoute, journeyPatientMenuOpen, visiblePatients, billingSearch, setBillingSearch, billingPatientSearchMatches, billingSelectedPatient, patientFilterId, patientLookupSearch, setPatientLookupSearch, patientLookupSearchMatches, selectedSharedPatient, moduleAiSupported, moduleAiText, moduleAiModalOpen, setModuleAiModalOpen, moduleAiContextJson, moduleAiMeta, showModuleAiResult, latestModuleAiRun, latestModuleAiOutput, moduleAiRuns, collection, production, todayVisits, utilization, patientScopedAppointments, dashboardWorkspace, scheduleWorkspace, scheduleScopedAppointments, patientWorkspace, clinicalWorkspace, crmWorkspace, formsWorkspace, journeyRecordsWorkspace, patientFilesWorkspace, pharmacyWorkspace, servicesWorkspace, staffDirectory, treatmentWorkspace, journeyReceipts, visibleInvoices, visiblePlans, journeyInvoiceIds, visibleClinicIds, patientScopedInvoices, patientScopedPatients, accountingWorkspace, reportsWorkspace, communityWorkspace, patientPortalWorkspace, staffPayrollWorkspace, inventoryWorkspace, learningWorkspace, settingsWorkspace } = model;
    return (<LanguageContext.Provider value={{ language, t }}>
      <div className="app-shell">
      <AppSidebar activeView={activeView} language={language} permittedViews={permittedViews}/>

      <main className="workspace">
        <AppTopbar activeLanguage={language} alertsLabel="Alerts" allChainsLabel={t.allChains} chainOptions={chainOptions} chainScopeId={chainScopeId} chainScopeLabel={t.chainScope} currentPath={viewRoutes[activeView]} eyebrow={t.topbarEyebrow} inboxLabel={t.inbox} languageLabel={t.language} notificationWorkspace={taskInboxWorkspace} onChainScopeChange={(value) => {
            setChainScopeId(value);
            setPatientFilterId("all");
        }} onLanguageChange={setLanguage} organizationName={session.organizationName} roleLabel={t.roles[session.role]} signOutLabel={t.signOut} title={titleFor(activeView, language)} userName={session.fullName}>
          {hasTopbarControls && (<div className="topbar-controls">
            {usesJourneyControls ? (<>
                <button className="secondary-button journey-patient-menu-trigger" type="button" onClick={() => setJourneyPatientMenuOpen(true)}>
                  <PanelRightOpen size={16} aria-hidden="true"/>
                  {journeyTopbarText[language].patientMenu}
                </button>
                <PatientSearchCombobox query={journeyChartSearch} onQueryChange={(value) => {
                    setJourneyChartSearch(value);
                    setJourneySearchShowsSelectedPatientLabel(value.length > 0);
                }} matches={journeyPatientSearchMatches} selectedPatient={journeySelectedPatient ?? undefined} showSelectedPatientLabel={journeySearchShowsSelectedPatientLabel} placeholder={journeyTopbarText[language].searchPlaceholder} selectLabel={journeyTopbarText[language].selectPatient} noResultsLabel={language === "vi" ? "Không có bệnh nhân phù hợp" : "No matching patients"} onSelect={selectJourneyPatient}/>
                {(journeyChartSearch ||
                    (journeySelectedPatient && journeySearchShowsSelectedPatientLabel)) && (<button className="chart-clear-search topbar-clear-search" type="button" onClick={() => {
                        setJourneyChartSearch("");
                        setJourneySearchShowsSelectedPatientLabel(false);
                    }}>
                    {journeyTopbarText[language].clearSearch}
                  </button>)}
                <JourneyPatientMenu appointments={visibleAppointments} billingWorkspace={billingWorkspace} clinics={visibleClinics} language={language} onClose={() => setJourneyPatientMenuOpen(false)} onOpenBilling={(patientId) => openPatientRoute("billing", patientId)} onOpenProfile={(patientId) => openPatientRoute("patients", patientId)} onSelect={(patient) => {
                    selectJourneyPatient(patient);
                    setJourneyPatientMenuOpen(false);
                }} open={journeyPatientMenuOpen} patients={visiblePatients} selectedPatientId={journeySelectedPatient?.id ?? ""}/>
              </>) : activeView === "billing" ? (<>
                <PatientSearchCombobox query={billingSearch} onQueryChange={(value) => {
                    setBillingSearch(value);
                    setPatientFilterId("all");
                }} matches={billingPatientSearchMatches} selectedPatient={billingSelectedPatient} placeholder={billingTopbarText[language].searchPlaceholder} selectLabel={t.selectPatient} noResultsLabel={language === "vi" ? "Không có bệnh nhân phù hợp" : "No matching patients"} onSelect={(patient) => {
                    setPatientFilterId(patient.id);
                    setBillingSearch("");
                }}/>
                {(billingSearch || patientFilterId !== "all") && (<button className="chart-clear-search topbar-clear-search" type="button" onClick={() => {
                        setBillingSearch("");
                        setPatientFilterId("all");
                    }}>
                    {billingTopbarText[language].clearSearch}
                  </button>)}
              </>) : (<>
                <PatientSearchCombobox query={patientLookupSearch} onQueryChange={(value) => {
                    setPatientLookupSearch(value);
                    setPatientFilterId("all");
                }} matches={patientLookupSearchMatches} selectedPatient={selectedSharedPatient} placeholder={t.patientSearchPlaceholder} selectLabel={t.selectPatient} noResultsLabel={language === "vi" ? "Không có bệnh nhân phù hợp" : "No matching patients"} onSelect={(patient) => {
                    setPatientFilterId(patient.id);
                    setPatientLookupSearch("");
                }}/>
                {(patientLookupSearch || patientFilterId !== "all") && (<button className="chart-clear-search topbar-clear-search" type="button" onClick={() => {
                        setPatientLookupSearch("");
                        setPatientFilterId("all");
                    }}>
                    {t.clearSearch}
                  </button>)}
              </>)}
          </div>)}
        </AppTopbar>

        {moduleAiSupported && (<ModuleAiFloatingShell closeLabel={moduleAiText.close} isOpen={moduleAiModalOpen} moduleTitle={moduleAiText.title} onClose={() => setModuleAiModalOpen(false)} onOpen={() => setModuleAiModalOpen(true)} openLabel={moduleAiText.open} routeTitle={titleFor(activeView, language)}>
            {moduleAiModalOpen ? (<>
              <form action={chatModuleWithAiAction} className="module-ai-chat-form">
                <input name="module" type="hidden" value={activeView}/>
                <input name="contextJson" type="hidden" value={moduleAiContextJson}/>
                <input name="selectedPatientId" type="hidden" value={usesJourneyControls ? journeySelectedPatient?.id ?? "" : ""}/>
                <input name="selectedPatientName" type="hidden" value={usesJourneyControls ? journeySelectedPatient?.name ?? "" : ""}/>
                <p className="module-ai-note">{moduleAiText.suggestionOnly}</p>
                {usesJourneyControls && journeySelectedPatient ? (<p className="module-ai-note">
                    {moduleAiText.patientContext}: {patientSearchDisplayLabel(journeySelectedPatient)}
                  </p>) : null}
                <label>
                  {moduleAiText.prompt}
                  <textarea name="task" placeholder={moduleAiText.placeholder} rows={4} maxLength={1200} required/>
                </label>
                <div className="accounting-ai-action">
                  <button className="primary-button compact-button" type="submit">
                    <MessageSquareText size={16}/>
                    {moduleAiText.action}
                  </button>
                  {moduleAiMeta && <span>{moduleAiMeta}</span>}
                </div>
              </form>
              {showModuleAiResult && latestModuleAiRun?.status === "FAILED" ? (<div className="schedule-alert accounting-warning">
                  {moduleAiText.failed}
                  {latestModuleAiRun.error ? `: ${latestModuleAiRun.error}` : ""}
                </div>) : showModuleAiResult && latestModuleAiOutput ? (<div className="accounting-ai-result">
                  <p>{latestModuleAiOutput.answer}</p>
                  {latestModuleAiOutput.takeaways.length > 0 && (<div>
                      <strong>{moduleAiText.takeaways}</strong>
                      <ul>
                        {latestModuleAiOutput.takeaways.map((item, index) => (<li key={`${item}-${index}`}>{item}</li>))}
                      </ul>
                    </div>)}
                  {latestModuleAiOutput.suggestedActions.length > 0 && (<div>
                      <strong>{moduleAiText.suggestedActions}</strong>
                      <ul>
                        {latestModuleAiOutput.suggestedActions.map((item, index) => (<li key={`${item}-${index}`}>{item}</li>))}
                      </ul>
                    </div>)}
                  {latestModuleAiOutput.caveats.length > 0 && (<div>
                      <strong>{moduleAiText.caveats}</strong>
                      <ul>
                        {latestModuleAiOutput.caveats.map((item, index) => (<li key={`${item}-${index}`}>{item}</li>))}
                      </ul>
                    </div>)}
                </div>) : (<EmptyState label={moduleAiText.empty}/>)}
              {moduleAiRuns && moduleAiRuns.length > 0 && (<div className="module-ai-history">
                  <strong>{moduleAiText.history}</strong>
                  {moduleAiRuns.slice(0, 5).map((run) => (<article className="module-ai-history-row" key={run.id}>
                      <div>
                        <span>{run.createdAt}</span>
                        <small>
                          {run.model}
                          {run.totalTokens ? ` · ${run.totalTokens} ${moduleAiText.tokens}` : ""}
                        </small>
                      </div>
                      <StatusPill status={run.status}/>
                    </article>))}
                </div>)}
              </>) : null}
          </ModuleAiFloatingShell>)}

        {activeView === "dashboard" && (<Dashboard collection={collection} production={production} todayVisits={todayVisits} utilization={utilization} visibleClinics={visibleClinics} visibleAppointments={patientScopedAppointments} taskInboxWorkspace={taskInboxWorkspace} dashboardWorkspace={dashboardWorkspace}/>)}
        {activeView === "schedule" && (<ScheduleBoard scheduleWorkspace={scheduleWorkspace} visibleAppointments={scheduleScopedAppointments} visibleClinics={visibleClinics}/>)}
        {activeView === "patients" && (<PatientsPanel patientWorkspace={patientWorkspace} role={session.role} text={workspaceText[language].patients} visibleClinics={visibleClinics} visiblePatients={visiblePatients}/>)}
        {(activeView === "journey" ||
            activeView === "clinical" ||
            activeView === "treatment") && (<PatientJourneyPanel actorName={session.fullName} billingWorkspace={billingWorkspace} clinicalWorkspace={clinicalWorkspace} crmWorkspace={crmWorkspace} formsWorkspace={formsWorkspace} journeyRecordsWorkspace={journeyRecordsWorkspace} patientFilesWorkspace={patientFilesWorkspace} patientWorkspace={patientWorkspace} pharmacyWorkspace={pharmacyWorkspace} scheduleWorkspace={scheduleWorkspace} servicesWorkspace={servicesWorkspace} staffDirectory={staffDirectory} session={session} treatmentWorkspace={treatmentWorkspace} chartSearch={journeyChartSearch} journeyReceipts={journeyReceipts} selectedPatientId={journeySelectedPatient?.id ?? ""} visibleAppointments={visibleAppointments} visibleClinics={visibleClinics} visibleInvoices={visibleInvoices} visiblePatients={visiblePatients} visiblePlans={visiblePlans}/>)}
        {activeView === "billing" && (<BillingPanel actorName={session.fullName} billingSearch={billingSearch} billingWorkspace={billingWorkspace} journeyInvoiceIds={journeyInvoiceIds} journeyReceipts={journeyReceipts} visibleClinicIds={visibleClinicIds} visibleAppointments={visibleAppointments} visibleClinics={visibleClinics} visibleInvoices={patientScopedInvoices} visiblePatients={patientScopedPatients}/>)}
        {activeView === "accounting" && (<AccountingPanel accountingWorkspace={accountingWorkspace} visibleClinics={visibleClinics}/>)}
        {activeView === "crm" && (<CrmPanel crmWorkspace={crmWorkspace} patientWorkspace={patientWorkspace} visibleClinicIds={visibleClinicIds}/>)}
        {activeView === "reports" && (<ReportsPanel reportsWorkspace={reportsWorkspace} visibleClinicIds={visibleClinicIds} visibleClinics={visibleClinics}/>)}
        {activeView === "community" && (<CommunityPanel communityWorkspace={communityWorkspace} visibleClinicIds={visibleClinicIds}/>)}
        {activeView === "patient-app" && (<PatientAppPanel patientPortalWorkspace={patientPortalWorkspace}/>)}
        {activeView === "employee-app" && (<EmployeeAppPanel session={session} staffPayrollWorkspace={staffPayrollWorkspace} visibleClinics={visibleClinics}/>)}
        {activeView === "services" && (<ServicesPanel servicesWorkspace={servicesWorkspace}/>)}
        {activeView === "pharmacy" && (<PharmacyPanel patientWorkspace={patientWorkspace} pharmacyWorkspace={pharmacyWorkspace} visibleClinicIds={visibleClinicIds}/>)}
        {activeView === "forms" && (<FormsPanel formsWorkspace={formsWorkspace} patientWorkspace={patientWorkspace} visibleClinicIds={visibleClinicIds}/>)}
        {activeView === "inventory" && (<InventoryPanel inventoryWorkspace={inventoryWorkspace} visibleClinics={visibleClinics}/>)}
        {activeView === "learning" && (<LearningPanel learningWorkspace={learningWorkspace} session={session} visibleClinics={visibleClinics}/>)}
        {activeView === "staff" && (<StaffPayrollPanel settingsWorkspace={settingsWorkspace} staffPayrollWorkspace={staffPayrollWorkspace} visibleClinics={visibleClinics}/>)}
        {activeView === "settings" && (<SettingsPanel settingsWorkspace={settingsWorkspace} clinicCount={visibleClinics.length} role={t.roles[session.role]}/>)}
      </main>
      </div>
    </LanguageContext.Provider>);
}

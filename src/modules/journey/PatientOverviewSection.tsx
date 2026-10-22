"use client";
import { FileText, Stethoscope, UsersRound } from "lucide-react";
import { createClinicalNoteAction } from "@/app/(app)/clinical/actions";
import { PanelHeader } from "@/components/suite-primitives";
import { formatVnd } from "@/lib/data";
import { displayStatus, patientCodeFor, patientClassCodeFor, patientInitials } from "./journey-shared";
import type { PatientJourneyPanelModel } from "./journey-model";
export function PatientOverviewSection(model: Pick<PatientJourneyPanelModel, "jt" | "selectedPatient" | "clinicName" | "language" | "selectedAppointments" | "totalDue" | "latestNote" | "selectedJourneyState" | "selectedTeeth" | "clinicalReady" | "latestExamFields" | "selectedTreatmentGoal" | "updateTreatmentDraft" | "canEditTreatmentPlan" | "journeyRecordsReady" | "selectedTreatmentPlanText">) {
    const { jt, selectedPatient, clinicName, language, selectedAppointments, totalDue, latestNote, selectedJourneyState, selectedTeeth, clinicalReady, latestExamFields, selectedTreatmentGoal, updateTreatmentDraft, canEditTreatmentPlan, journeyRecordsReady, selectedTreatmentPlanText } = model;
    if (!selectedPatient)
        return null;
    return (<section className="patient-chart-paired-blocks">
          <section className="panel patient-chart-header" id="chart-admin">
            <PanelHeader icon={UsersRound} title={jt.admin.title} action={jt.actions.admin}/>


            <div className="patient-chart-topline">
              <div className="patient-chart-identity">
                <div className="avatar patient-chart-avatar">
                  {patientInitials(selectedPatient.name)}
                </div>
                <div>
                  <p className="eyebrow">{jt.admin.patientRecord}</p>
                  <h2>{selectedPatient.name}</h2>
                  <div className="patient-chart-meta">
                    <span className="code-chip">
                      {patientCodeFor(selectedPatient)} · {patientClassCodeFor(selectedPatient)}
                    </span>
                    <span>{selectedPatient.phone}</span>
                    <span>{selectedPatient.email ?? jt.admin.noEmail}</span>
                    <span>{clinicName}</span>
                  </div>
                </div>
              </div>

            </div>

            <div className="patient-chart-stats">
              <div>
                <span>{jt.admin.age}</span>
                <strong>{selectedPatient.age || jt.admin.unknown}</strong>
              </div>
              <div>
                <span>{jt.admin.consent}</span>
                <strong>{displayStatus(selectedPatient.consent, language)}</strong>
              </div>
              <div>
                <span>{jt.admin.sessions}</span>
                <strong>{selectedAppointments.length}</strong>
              </div>
              <div>
                <span>{jt.admin.debt}</span>
                <strong>{formatVnd(totalDue)}</strong>
              </div>
            </div>

            <details className="patient-admin-details">
              <summary>
                <strong>{jt.admin.extendedInfo}</strong>
                <span>
                  {selectedPatient.dateOfBirth ?? jt.admin.unknown} ·{" "}
                  {selectedPatient.address ?? selectedPatient.city}
                </span>
              </summary>
              <dl className="journey-detail-list compact patient-admin-list">
                <div>
                  <dt>{jt.admin.patientCode}</dt>
                  <dd>
                    {patientCodeFor(selectedPatient)} · {patientClassCodeFor(selectedPatient)}
                  </dd>
                </div>
                <div>
                  <dt>{jt.admin.dobAge}</dt>
                  <dd>
                    {selectedPatient.dateOfBirth ?? jt.admin.unknown} /{" "}
                    {selectedPatient.age || jt.admin.unknown}
                  </dd>
                </div>
                <div>
                  <dt>{jt.admin.guardian}</dt>
                  <dd>{selectedPatient.guardianName ?? jt.admin.notApplicable}</dd>
                </div>
                <div>
                  <dt>{jt.admin.nationalId}</dt>
                  <dd>{selectedPatient.nationalId ?? jt.admin.unknown}</dd>
                </div>
                <div>
                  <dt>{jt.admin.address}</dt>
                  <dd>{selectedPatient.address ?? selectedPatient.city}</dd>
                </div>
                <div>
                  <dt>{jt.admin.consent}</dt>
                  <dd>
                    {displayStatus(selectedPatient.consent, language)} -{" "}
                    {selectedPatient.consentSignedAt ?? jt.admin.unsignedDate}
                  </dd>
                </div>
              </dl>
            </details>

            <div className="patient-safety-strip">
              {selectedPatient.flags.map((flag) => (<span key={flag}>{flag}</span>))}
            </div>
          </section>

          <section className="panel journey-clinical-panel" id="chart-note">
            <PanelHeader icon={Stethoscope} title={jt.clinical.title}/>
            <form action={createClinicalNoteAction} className="clinical-intake-form clinical-plan-form" key={`${selectedPatient.id}-${latestNote?.id ?? "new"}-${selectedJourneyState?.updatedAt ?? "draft"}`}>
              <input name="patientId" type="hidden" value={selectedPatient.id}/>
              <input name="odontogramTeeth" type="hidden" value={selectedTeeth.join("\n")}/>
              <label className="clinical-wide">
                {jt.clinical.reason}
                <textarea name="subjective" defaultValue={selectedPatient.visitReason ?? latestNote?.subjective ?? ""} placeholder={jt.clinical.reasonPlaceholder} disabled={!clinicalReady}/>
              </label>
              <label>
                {jt.clinical.historyAllergy}
                <textarea name="objective" defaultValue={latestExamFields.objective} placeholder={jt.clinical.historyAllergyPlaceholder} disabled={!clinicalReady}/>
              </label>
              <label>
                {jt.clinical.history}
                <textarea name="medicalHistory" defaultValue={latestExamFields.medicalHistory} placeholder={jt.clinical.historyPlaceholder} disabled={!clinicalReady}/>
              </label>
              <div className="vitals-grid">
                <label>
                  {jt.clinical.heartRate}
                  <input name="heartRate" defaultValue={latestExamFields.heartRate} placeholder="78 bpm" disabled={!clinicalReady}/>
                </label>
                <label>
                  {jt.clinical.temperature}
                  <input name="temperature" defaultValue={latestExamFields.temperature} placeholder="36.8 C" disabled={!clinicalReady}/>
                </label>
                <label>
                  {jt.clinical.bloodPressure}
                  <input name="bloodPressure" defaultValue={latestExamFields.bloodPressure} placeholder="120/80" disabled={!clinicalReady}/>
                </label>
              </div>
              <label>
                {jt.clinical.assessment}
                <textarea name="assessment" defaultValue="" placeholder={jt.clinical.assessmentPlaceholder} disabled={!clinicalReady}/>
              </label>
              <label>
                {jt.clinical.prognosis}
                <textarea name="prognosis" defaultValue="" placeholder={jt.clinical.prognosisPlaceholder} disabled={!clinicalReady}/>
              </label>
              <label>
                {jt.plan.goalField}
                <textarea name="treatmentGoal" defaultValue={selectedTreatmentGoal} onChange={(event) => updateTreatmentDraft("goal", event.target.value)} placeholder={jt.plan.goalPlaceholder} disabled={!canEditTreatmentPlan || !journeyRecordsReady}/>
              </label>
              <label>
                {jt.plan.planField}
                <textarea name="treatmentPlan" defaultValue={selectedTreatmentPlanText} onChange={(event) => updateTreatmentDraft("plan", event.target.value)} placeholder={jt.plan.planPlaceholder} disabled={!canEditTreatmentPlan || !journeyRecordsReady}/>
              </label>
              <button className="primary-button clinical-wide" type="submit" disabled={!clinicalReady}>
                <FileText size={16}/>
                {jt.clinical.save}
              </button>
            </form>
          </section>
          </section>);
}

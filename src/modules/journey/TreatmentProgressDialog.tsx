"use client";
import { OperationalDialog } from "@/components/ui/WorkspaceControls";
import { ClipboardList, } from "lucide-react";
import { recordJourneyServiceProgressAction } from "@/app/(app)/journey/actions";
import { StatusPill, serviceProgressLabelFromPercent, } from "./journey-shared";
import type { PatientJourneyPanelModel } from "./journey-model";
export function TreatmentProgressDialog(model: Pick<PatientJourneyPanelModel, "jt" | "setPendingProgressUpdate" | "pendingProgressUpdate" | "selectedPatient" | "language" | "progressParticipants" | "session">) {
    const { jt, setPendingProgressUpdate, pendingProgressUpdate, selectedPatient, language, progressParticipants, session } = model;
    if (!pendingProgressUpdate || !selectedPatient)
        return null;
    return (<OperationalDialog label={jt.services.recordProgress} onClose={() => setPendingProgressUpdate(null)}>
          <form action={recordJourneyServiceProgressAction} className="progress-modal journey-progress-modal" onClick={(event) => event.stopPropagation()} onSubmit={() => setPendingProgressUpdate(null)}>
            <input name="treatmentServiceId" type="hidden" value={pendingProgressUpdate.serviceId}/>
            <input name="patientId" type="hidden" value={selectedPatient.id}/>
            <input name="toProgressPercent" type="hidden" value={pendingProgressUpdate.toProgressPercent}/>
            <div className="progress-modal-header">
              <div>
                <span>{pendingProgressUpdate.serviceLabel}</span>
                <h3>{pendingProgressUpdate.serviceName}</h3>
              </div>
              <StatusPill status={`${serviceProgressLabelFromPercent(pendingProgressUpdate.fromProgressPercent, undefined, pendingProgressUpdate.steps)} -> ${serviceProgressLabelFromPercent(pendingProgressUpdate.toProgressPercent, undefined, pendingProgressUpdate.steps)}`}/>
            </div>
            <div className="progress-modal-grid modal-form-grid">
              <label>
                {jt.services.consultant}
                <select name="consultantId" defaultValue={pendingProgressUpdate.consultantId ?? ""}>
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (<option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>))}
                </select>
              </label>
              <label>
                {jt.services.performedBy}
                <select name="performedById" defaultValue={session.userId}>
                  {progressParticipants.map((member) => (<option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>))}
                </select>
              </label>
              <label>
                {jt.services.clinicalSupport}
                <select name="clinicalSupportId" defaultValue="">
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (<option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>))}
                </select>
              </label>
              <label>
                {jt.services.assistantPrimary}
                <select name="assistantPrimaryId" defaultValue="">
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (<option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>))}
                </select>
              </label>
              <label>
                {jt.services.assistantSecondary}
                <select name="assistantSecondaryId" defaultValue="">
                  <option value="">
                    {language === "vi" ? "Không chọn" : "Not selected"}
                  </option>
                  {progressParticipants.map((member) => (<option value={member.id} key={member.id}>
                      {member.fullName}
                    </option>))}
                </select>
              </label>
              <label className="progress-modal-note">
                {language === "vi" ? "Ghi chú tiến độ" : "Progress note"}
                <textarea name="note" placeholder={language === "vi"
            ? "Ví dụ: hoàn tất bước lấy dấu, bệnh nhân ổn định"
            : "Example: impression step completed, patient stable"}/>
              </label>
            </div>
            <div className="progress-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setPendingProgressUpdate(null)}>
                {language === "vi" ? "Hủy" : "Cancel"}
              </button>
              <button className="primary-button" type="submit">
                <ClipboardList size={16}/>
                {jt.services.recordProgress}
              </button>
            </div>
          </form>
        </OperationalDialog>);
}

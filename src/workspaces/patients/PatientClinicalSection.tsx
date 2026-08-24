"use client";

import {
  createClinicalNoteAction,
  lockClinicalNoteAction,
} from "@/features/patient-360/server/clinical-actions";
import type { Patient } from "@/lib/data";
import { hasAnyRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import { splitClinicalObjective } from "./patient-360-helpers";
import native from "./patient-360-native.module.css";

export function PatientClinicalSection({
  model,
  patient,
  session,
}: {
  model: Patient360WorkspaceModel;
  patient: Patient;
  session: AppSession;
}) {
  const notes = model.clinicalWorkspace?.notes.filter((note) => note.patientId === patient.id) ?? [];
  const latestNote = notes[0] ?? null;
  const latestFields = splitClinicalObjective(latestNote?.objective);
  const journeyState = model.journeyRecordsWorkspace?.states.find((state) => state.patientId === patient.id) ?? null;
  const canEditClinical = Boolean(model.clinicalWorkspace?.canMutate);
  const canSign = hasAnyRole(session, ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST", "HYGIENIST"]);
  const canEditPlan = hasAnyRole(session, ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER", "DENTIST"]);
  const unfinished = notes.filter((note) => !note.lockedAt);
  const finalized = notes.filter((note) => note.lockedAt).slice(0, 5);

  return (
    <section className={native.card} id="patient-clinical">
      <header className={native.cardHeader}>
        <div>
          <h2>Khám & kế hoạch điều trị</h2>
          <p>Ghi chú mới được lưu vào timeline và giữ nguyên audit/signing semantics.</p>
        </div>
        <span className={native.badge}>{notes.length} ghi chú</span>
      </header>

      <form action={createClinicalNoteAction} className={native.formGrid}>
        <input name="patientId" type="hidden" value={patient.id} />
        <input name="odontogramTeeth" type="hidden" value={journeyState?.odontogramTeeth.join("\n") ?? ""} />
        <label className={native.wide}>
          Lý do đến khám
          <textarea name="subjective" defaultValue={patient.visitReason ?? latestNote?.subjective ?? ""} disabled={!canEditClinical} />
        </label>
        <label>
          Khám lâm sàng / tiền sử thuốc
          <textarea name="objective" defaultValue={latestFields.objective} disabled={!canEditClinical} />
        </label>
        <label>
          Bệnh sử
          <textarea name="medicalHistory" defaultValue={latestFields.medicalHistory} disabled={!canEditClinical} />
        </label>
        <label>Mạch<input name="heartRate" defaultValue={latestFields.heartRate} disabled={!canEditClinical} placeholder="78 bpm" /></label>
        <label>Nhiệt độ<input name="temperature" defaultValue={latestFields.temperature} disabled={!canEditClinical} placeholder="36.8 C" /></label>
        <label>Huyết áp<input name="bloodPressure" defaultValue={latestFields.bloodPressure} disabled={!canEditClinical} placeholder="120/80" /></label>
        <label>Đánh giá<textarea name="assessment" disabled={!canEditClinical} /></label>
        <label>Tiên lượng<textarea name="prognosis" disabled={!canEditClinical} /></label>
        <label>
          Mục tiêu điều trị
          <textarea name="treatmentGoal" defaultValue={journeyState?.treatmentGoal ?? ""} disabled={!canEditClinical || !canEditPlan} />
        </label>
        <label>
          Kế hoạch điều trị
          <textarea name="treatmentPlan" defaultValue={journeyState?.treatmentPlan ?? ""} disabled={!canEditClinical || !canEditPlan} />
        </label>
        <div className={`${native.actions} ${native.wide}`}>
          <button className={native.button} disabled={!canEditClinical} type="submit">Thêm vào timeline</button>
        </div>
      </form>

      {unfinished.length > 0 && (
        <div className={native.noteList} style={{ marginTop: 18 }}>
          <div className={native.meta}>Ghi chú chưa hoàn tất</div>
          {unfinished.map((note) => (
            <article className={native.note} key={note.id}>
              <div className={native.noteHeader}>
                <strong>{note.assessment ?? note.prognosis ?? note.subjective ?? "Ghi chú khám"}</strong>
                <span className={native.meta}>{note.createdAt}</span>
              </div>
              <p>{[note.subjective, note.objective, note.plan].filter(Boolean).join(" · ")}</p>
              {canSign && (
                <form action={lockClinicalNoteAction} className={native.actions}>
                  <input name="noteId" type="hidden" value={note.id} />
                  <button className={native.buttonSecondary} type="submit">Hoàn tất ghi chú</button>
                </form>
              )}
            </article>
          ))}
        </div>
      )}

      {finalized.length > 0 && (
        <details style={{ marginTop: 18 }}>
          <summary className={native.meta}>Ghi chú đã hoàn tất gần đây</summary>
          <div className={native.noteList} style={{ marginTop: 10 }}>
            {finalized.map((note) => (
              <article className={native.note} key={note.id}>
                <div className={native.noteHeader}>
                  <strong>{note.assessment ?? note.prognosis ?? note.subjective ?? "Ghi chú khám"}</strong>
                  <span className={native.meta}>{note.createdAt}</span>
                </div>
                <p>{[note.subjective, note.objective, note.prognosis, note.plan].filter(Boolean).join(" · ")}</p>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import {
  updatePatientAction,
  updatePatientConsentAction,
  updatePatientLeadSourceAction,
} from "@/features/patient-360/server/patient-actions";
import { formatVnd, type Patient } from "@/lib/data";
import { hasAnyRole } from "@/lib/permissions";
import type { AppSession } from "@/lib/session";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import {
  genderLabel,
  leadSourceLabel,
  patientCodeFor,
  patientLeadSources,
} from "./patient-360-helpers";
import native from "./patient-360-native.module.css";

export function PatientProfileSection({
  model,
  patient,
  session,
}: {
  model: Patient360WorkspaceModel;
  patient: Patient;
  session: AppSession;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const clinics = model.patientWorkspace.clinics.filter((clinic) => clinic.active !== false);
  const canEdit = model.patientWorkspace.canMutate && clinics.length > 0;
  const canGovernSource = canEdit && hasAnyRole(session, ["OWNER", "AREA_MANAGER", "CLINIC_MANAGER"]);
  const clinicName = clinics.find((clinic) => clinic.id === patient.clinicId)?.name ?? patient.city;

  return (
    <section className={native.card} id="patient-profile">
      <header className={native.cardHeader}>
        <div>
          <h2>Thông tin hành chính</h2>
          <p>{patientCodeFor(patient)} · {clinicName}</p>
        </div>
        <button className={native.buttonSecondary} disabled={!canEdit} onClick={() => setEditOpen(true)} type="button">
          Chỉnh sửa
        </button>
      </header>

      <div className={native.factGrid}>
        <div className={native.fact}><span>Điện thoại</span><strong>{patient.phone}</strong></div>
        <div className={native.fact}><span>Email</span><strong>{patient.email ?? "Chưa có"}</strong></div>
        <div className={native.fact}><span>Giới tính</span><strong>{genderLabel(patient.gender)}</strong></div>
        <div className={native.fact}><span>Ngày sinh / tuổi</span><strong>{patient.dateOfBirth ?? "Chưa rõ"} · {patient.age || "?"}</strong></div>
        <div className={native.fact}><span>Nguồn khách</span><strong>{leadSourceLabel(patient.leadSource)}</strong></div>
        <div className={native.fact}><span>Công nợ</span><strong>{formatVnd(patient.balance)}</strong></div>
        <div className={native.fact}><span>Địa chỉ</span><strong>{patient.address ?? patient.city}</strong></div>
        <div className={native.fact}><span>CMND/CCCD</span><strong>{patient.nationalId ?? "Chưa có"}</strong></div>
        <div className={native.fact}><span>Người giám hộ</span><strong>{patient.guardianName ?? "Không áp dụng"}</strong></div>
      </div>

      {patient.flags.length > 0 && (
        <div className={native.alerts} aria-label="Cảnh báo y khoa">
          {patient.flags.map((flag) => <span key={flag}>{flag}</span>)}
        </div>
      )}

      <div className={native.actions}>
        <form action={updatePatientConsentAction}>
          <input name="patientId" type="hidden" value={patient.id} />
          <input name="status" type="hidden" value="GRANTED" />
          <button className={native.buttonSecondary} disabled={!canEdit} type="submit">Xác nhận đồng thuận</button>
        </form>
        <form action={updatePatientConsentAction}>
          <input name="patientId" type="hidden" value={patient.id} />
          <input name="status" type="hidden" value="EXPIRED" />
          <button className={native.buttonSecondary} disabled={!canEdit} type="submit">Cần gia hạn đồng thuận</button>
        </form>
      </div>

      {patient.consentHistory?.length ? (
        <div className={native.noteList} style={{ marginTop: 14 }}>
          {patient.consentHistory.slice(0, 4).map((record) => (
            <div className={native.note} key={record.id}>
              <div className={native.noteHeader}>
                <strong>{record.status}</strong>
                <span className={native.meta}>{record.recordedAt}</span>
              </div>
              <p>Phiên bản {record.version} · {record.channel}{record.signedAt ? ` · ký ${record.signedAt}` : ""}</p>
            </div>
          ))}
        </div>
      ) : null}

      {editOpen && (
        <div className={native.modalBackdrop} onClick={() => setEditOpen(false)} role="presentation">
          <div className={native.modal} onClick={(event) => event.stopPropagation()}>
            <header className={native.modalHeader}>
              <div><span className={native.meta}>{patientCodeFor(patient)}</span><h3>Chỉnh sửa hồ sơ</h3></div>
              <button className={native.buttonSecondary} onClick={() => setEditOpen(false)} type="button">Đóng</button>
            </header>

            <form action={updatePatientAction} className={native.formGrid}>
              <input name="patientId" type="hidden" value={patient.id} />
              <label>Chi nhánh<select name="clinicId" defaultValue={patient.clinicId} required>{clinics.map((clinic) => <option key={clinic.id} value={clinic.id}>{clinic.name}</option>)}</select></label>
              <label>Họ tên<input name="fullName" defaultValue={patient.name} required /></label>
              <label>Điện thoại<input name="phone" defaultValue={patient.phone} required /></label>
              <label>Email<input name="email" type="email" defaultValue={patient.email ?? ""} /></label>
              <label>Giới tính<select name="gender" defaultValue={patient.gender ?? "UNKNOWN"}><option value="UNKNOWN">Chưa rõ</option><option value="FEMALE">Nữ</option><option value="MALE">Nam</option><option value="OTHER">Khác</option></select></label>
              <label>Ngày sinh<input name="dateOfBirth" type="date" defaultValue={patient.dateOfBirth ?? ""} /></label>
              <label>Người giám hộ<input name="guardianName" defaultValue={patient.guardianName ?? ""} /></label>
              <label>CMND/CCCD<input name="nationalId" defaultValue={patient.nationalId ?? ""} /></label>
              <label className={native.wide}>Địa chỉ<input name="address" defaultValue={patient.address ?? ""} /></label>
              <label className={native.wide}>Lý do khám<textarea name="visitReason" defaultValue={patient.visitReason ?? ""} /></label>
              <label className={native.wide}>Cảnh báo y khoa<textarea name="medicalAlerts" defaultValue={patient.flags.join(", ")} /></label>
              <div className={`${native.actions} ${native.wide}`}>
                <button className={native.buttonSecondary} onClick={() => setEditOpen(false)} type="button">Hủy</button>
                <button className={native.button} disabled={!canEdit} type="submit">Lưu hồ sơ</button>
              </div>
            </form>

            <form action={updatePatientLeadSourceAction} className={native.formGrid} style={{ marginTop: 20 }}>
              <input name="patientId" type="hidden" value={patient.id} />
              <label>Nguồn khách<select name="leadSource" defaultValue={patient.leadSource ?? "WALK_IN"} disabled={!canGovernSource}>{patientLeadSources.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Lý do thay đổi<input name="reason" disabled={!canGovernSource} required /></label>
              <div className={`${native.actions} ${native.wide}`}>
                <button className={native.buttonSecondary} disabled={!canGovernSource} type="submit">Lưu nguồn khách</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

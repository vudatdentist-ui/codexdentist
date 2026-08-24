"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { createPatientAction } from "@/features/patient-360/server/patient-actions";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import { normalizePatientSearch, patientLeadSources } from "./patient-360-helpers";
import styles from "./patient-360-workspace.module.css";
import native from "./patient-360-native.module.css";

export function PatientDirectory({ model }: { model: Patient360WorkspaceModel }) {
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const normalizedQuery = normalizePatientSearch(query);
  const clinicById = useMemo(
    () => new Map(model.patientWorkspace.clinics.map((clinic) => [clinic.id, clinic.name])),
    [model.patientWorkspace.clinics],
  );
  const patients = useMemo(() => {
    if (!normalizedQuery) return model.patientWorkspace.patients;

    return model.patientWorkspace.patients.filter((patient) =>
      [
        patient.name,
        patient.phone,
        patient.patientCode,
        patient.email,
        patient.visitReason,
        patient.city,
        patient.nationalId,
      ].some((value) => normalizePatientSearch(value).includes(normalizedQuery)),
    );
  }, [model.patientWorkspace.patients, normalizedQuery]);
  const clinics = model.patientWorkspace.clinics.filter((clinic) => clinic.active !== false);
  const canCreate = model.patientWorkspace.canMutate && clinics.length > 0;

  return (
    <div className={styles.page}>
      <header className={styles.directoryHeader}>
        <div>
          <span className={styles.eyebrow}>Bệnh nhân</span>
          <h1>Hồ sơ bệnh nhân 360</h1>
          <p>{model.patientWorkspace.patients.length} hồ sơ trong phạm vi hiện tại</p>
        </div>
        <button
          className={native.buttonSecondary}
          disabled={!canCreate}
          onClick={() => setCreateOpen(true)}
          type="button"
        >
          Thêm bệnh nhân
        </button>
      </header>

      {model.patientWorkspace.message && (
        <p className={styles.notice}>{model.patientWorkspace.message}</p>
      )}

      <label className={styles.searchField}>
        <span>Tìm bệnh nhân</span>
        <input
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Tên, mã, số điện thoại, lý do khám..."
          type="search"
          value={query}
        />
      </label>

      <section className={styles.directorySection}>
        <div className={styles.sectionHeading}>
          <h2>{normalizedQuery ? "Kết quả" : "Tất cả bệnh nhân"}</h2>
          <span>{patients.length}</span>
        </div>

        {patients.length > 0 ? (
          <div className={styles.patientRows}>
            {patients.map((patient) => (
              <Link
                className={styles.patientRow}
                href={`/patients/${encodeURIComponent(patient.id)}`}
                key={patient.id}
              >
                <div className={styles.patientIdentity}>
                  <strong>{patient.name}</strong>
                  <span>
                    {patient.patientCode ? `${patient.patientCode} · ` : ""}
                    {patient.phone}
                  </span>
                </div>
                <span className={styles.rowContext}>
                  {clinicById.get(patient.clinicId) ?? patient.city}
                  {patient.visitReason ? ` · ${patient.visitReason}` : ""}
                </span>
                <span className={styles.rowState}>
                  {patient.nextVisit && patient.nextVisit !== "Not booked"
                    ? `Hẹn: ${patient.nextVisit}`
                    : patient.lastVisit && patient.lastVisit !== "No visit"
                      ? `Gần nhất: ${patient.lastVisit}`
                      : "Chưa có lịch hẹn"}
                </span>
                <span className={styles.openAction}>Mở hồ sơ →</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>Không tìm thấy bệnh nhân phù hợp.</p>
        )}
      </section>

      {createOpen && (
        <div className={native.modalBackdrop} onClick={() => setCreateOpen(false)} role="presentation">
          <form
            action={createPatientAction}
            className={native.modal}
            onClick={(event) => event.stopPropagation()}
          >
            <header className={native.modalHeader}>
              <div>
                <span className={styles.eyebrow}>Tiếp nhận bệnh nhân</span>
                <h3>Hồ sơ mới</h3>
              </div>
              <button className={native.buttonSecondary} onClick={() => setCreateOpen(false)} type="button">
                Đóng
              </button>
            </header>

            <div className={native.formGrid}>
              <label>
                Chi nhánh
                <select name="clinicId" required defaultValue={clinics[0]?.id ?? ""}>
                  {clinics.map((clinic) => (
                    <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Họ tên
                <input name="fullName" required />
              </label>
              <label>
                Điện thoại
                <input name="phone" required />
              </label>
              <label>
                Email
                <input name="email" type="email" />
              </label>
              <label>
                Giới tính
                <select name="gender" defaultValue="UNKNOWN">
                  <option value="UNKNOWN">Chưa rõ</option>
                  <option value="FEMALE">Nữ</option>
                  <option value="MALE">Nam</option>
                  <option value="OTHER">Khác</option>
                </select>
              </label>
              <label>
                Ngày sinh
                <input name="dateOfBirth" type="date" />
              </label>
              <label>
                Nguồn khách
                <select name="leadSource" defaultValue="WALK_IN">
                  {patientLeadSources.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <label>
                Người giám hộ
                <input name="guardianName" />
              </label>
              <label>
                CMND/CCCD
                <input name="nationalId" />
              </label>
              <label>
                Địa chỉ
                <input name="address" />
              </label>
              <label className={native.wide}>
                Lý do khám
                <textarea name="visitReason" />
              </label>
              <label className={native.wide}>
                Cảnh báo y khoa
                <textarea name="medicalAlerts" placeholder="Phân cách bằng dấu phẩy" />
              </label>
            </div>
            <div className={native.actions}>
              <button className={native.buttonSecondary} onClick={() => setCreateOpen(false)} type="button">Hủy</button>
              <button className={native.button} type="submit">Tạo hồ sơ</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { formatVnd, type Patient } from "@/lib/data";
import type { AppSession } from "@/lib/session";
import type { Patient360WorkspaceModel } from "./get-patient-360-workspace";
import { PatientClinicalSection } from "./PatientClinicalSection";
import { PatientDirectory } from "./PatientDirectory";
import { PatientProfileSection } from "./PatientProfileSection";
import { PatientTimelineSection } from "./PatientTimelineSection";
import { PatientTreatmentSection } from "./PatientTreatmentSection";
import { genderLabel, noticeLabel, patientCodeFor } from "./patient-360-helpers";
import native from "./patient-360-native.module.css";
import styles from "./patient-360-workspace.module.css";

export function Patient360Experience({
  model,
  session,
}: {
  model: Patient360WorkspaceModel;
  session: AppSession;
}) {
  const selectedPatient = model.selectedPatientId
    ? model.patientWorkspace.patients.find((patient) => patient.id === model.selectedPatientId) ?? null
    : null;

  return selectedPatient ? (
    <PatientChart model={model} patient={selectedPatient} session={session} />
  ) : (
    <PatientDirectory model={model} />
  );
}

function PatientChart({
  model,
  patient,
  session,
}: {
  model: Patient360WorkspaceModel;
  patient: Patient;
  session: AppSession;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamString = searchParams.toString();
  const notice = noticeLabel(searchParams.get("notice"));
  const clinicName = model.patientWorkspace.clinics.find((clinic) => clinic.id === patient.clinicId)?.name ?? patient.city;

  useEffect(() => {
    const canonicalPath = `/patients/${encodeURIComponent(patient.id)}`;
    if (pathname === canonicalPath) return;

    const nextParams = new URLSearchParams(searchParamString);
    nextParams.delete("patientId");
    const query = nextParams.toString();
    router.replace(query ? `${canonicalPath}?${query}` : canonicalPath, { scroll: false });
  }, [patient.id, pathname, router, searchParamString]);

  return (
    <div className={styles.chartPage}>
      <header className={styles.chartHeader}>
        <div className={styles.chartIdentity}>
          <Link className={styles.backLink} href="/patients">← Bệnh nhân</Link>
          <span className={styles.eyebrow}>Hồ sơ bệnh nhân 360</span>
          <div className={styles.chartTitleRow}>
            <h1>{patient.name}</h1>
            <span>{patientCodeFor(patient)}</span>
          </div>
          <p>
            {patient.phone}
            {patient.age ? ` · ${patient.age} tuổi` : ""}
            {patient.gender ? ` · ${genderLabel(patient.gender)}` : ""}
            {clinicName ? ` · ${clinicName}` : ""}
          </p>
        </div>

        <div className={styles.chartFacts} aria-label="Tóm tắt bệnh nhân">
          <div><span>Công nợ</span><strong>{formatVnd(patient.balance)}</strong></div>
          <div><span>Lịch tiếp theo</span><strong>{patient.nextVisit || "Chưa đặt"}</strong></div>
          <div><span>Đồng thuận</span><strong>{patient.consent === "Granted" ? "Đã đồng ý" : "Cần cập nhật"}</strong></div>
        </div>
      </header>

      <div className={styles.patientCanvas}>
        {notice ? <div className={native.notice}>{notice}</div> : null}
        <nav className={native.sectionNav} aria-label="Mục hồ sơ bệnh nhân">
          <a href="#patient-profile">Hành chính</a>
          <a href="#patient-clinical">Khám & kế hoạch</a>
          <a href="#patient-treatment">Odontogram</a>
          <a href="#patient-services">Dịch vụ</a>
          <a href="#patient-timeline">Timeline</a>
        </nav>

        <div className={native.stack}>
          <div className={native.gridTwo}>
            <PatientProfileSection model={model} patient={patient} session={session} />
            <PatientClinicalSection model={model} patient={patient} session={session} />
          </div>
          <PatientTreatmentSection model={model} patient={patient} session={session} />
          <PatientTimelineSection model={model} patient={patient} />
        </div>
      </div>
    </div>
  );
}
